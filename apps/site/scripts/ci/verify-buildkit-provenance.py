#!/usr/bin/env python3
"""Fetch and verify the exact BuildKit SLSA v1 attestation attached to an image."""

import argparse
import base64
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

MAX_RESPONSE = 16 * 1024 * 1024
TRUSTED_REGISTRY_RESPONSE_HOSTS = frozenset({
    "ghcr.io",
    "pkg-containers.githubusercontent.com",
})
INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json"
CONFIG_MEDIA_TYPE = "application/vnd.oci.image.config.v1+json"
LAYER_MEDIA_TYPES = {
    "application/vnd.oci.image.layer.v1.tar",
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.oci.image.layer.v1.tar+zstd",
}
ATTESTATION_ARTIFACT_TYPE = "application/vnd.docker.attestation.manifest.v1+json"
IN_TOTO_MEDIA_TYPE = "application/vnd.in-toto+json"
PREDICATE_TYPE = "https://slsa.dev/provenance/v1"
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
BUILD_TYPE = "https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest_bytes(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


class GhcrClient:
    def __init__(self, repository, actor, token):
        match = re.fullmatch(r"ghcr\.io/([a-z0-9_.-]+/[a-z0-9_.-]+)", repository)
        require(match, "repository must be an exact ghcr.io owner/name reference")
        self.name = match.group(1)
        credential = base64.b64encode(f"{actor}:{token}".encode()).decode()
        query = urllib.parse.urlencode({
            "service": "ghcr.io",
            "scope": f"repository:{self.name}:pull",
        })
        request = urllib.request.Request(
            f"https://ghcr.io/token?{query}",
            headers={"Authorization": f"Basic {credential}"},
        )
        response = self._read(request)
        self.token = json.loads(response)["token"]
        require(isinstance(self.token, str) and self.token, "registry token response is invalid")

    @staticmethod
    def _read(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            final = urllib.parse.urlsplit(response.geturl())
            allowed_host = final.hostname in TRUSTED_REGISTRY_RESPONSE_HOSTS
            require(final.scheme == "https" and allowed_host, "registry redirect target is not trusted")
            length = response.headers.get("Content-Length")
            require(length is None or int(length) <= MAX_RESPONSE, "registry response is too large")
            value = response.read(MAX_RESPONSE + 1)
        require(len(value) <= MAX_RESPONSE, "registry response is too large")
        return value

    def _get(self, kind, reference, accept):
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", reference), "invalid registry digest")
        request = urllib.request.Request(
            f"https://ghcr.io/v2/{self.name}/{kind}/{reference}",
            headers={"Authorization": f"Bearer {self.token}", "Accept": accept},
        )
        return self._read(request)

    def manifest(self, reference):
        return self._get(
            "manifests",
            reference,
            f"{INDEX_MEDIA_TYPE}, {MANIFEST_MEDIA_TYPE}, application/vnd.docker.distribution.manifest.list.v2+json",
        )

    def blob(self, reference):
        return self._get("blobs", reference, "application/octet-stream, application/json")


def checked_fetch(fetch, kind, descriptor):
    digest = descriptor.get("digest")
    require(isinstance(digest, str), f"{kind} descriptor has no digest")
    value = fetch(digest)
    require(digest_bytes(value) == digest, f"{kind} bytes do not match descriptor digest")
    size = descriptor.get("size")
    require(type(size) is int and size == len(value), f"{kind} bytes do not match descriptor size")
    return value


def checked_descriptor(kind, descriptor, media_types):
    require(isinstance(descriptor, dict), f"{kind} descriptor is invalid")
    require(descriptor.get("mediaType") in media_types, f"{kind} descriptor has wrong media type")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", descriptor.get("digest", "")), f"{kind} descriptor has invalid digest")
    require(type(descriptor.get("size")) is int and descriptor["size"] > 0, f"{kind} descriptor has invalid size")


def verify_graph(client, index_digest, source, sdk_revision, sdk_version, builder_id):
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", index_digest), "invalid index digest")
    require(re.fullmatch(r"[0-9a-f]{40}", source), "invalid source revision")
    require(re.fullmatch(r"[0-9a-f]{40}", sdk_revision), "invalid SDK revision")
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", sdk_version), "invalid SDK version")
    require(re.fullmatch(r"https://github\.com/hermawan22/varendo/actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*", builder_id), "invalid builder ID")

    index_bytes = client.manifest(index_digest)
    require(digest_bytes(index_bytes) == index_digest, "index bytes do not match published digest")
    index = json.loads(index_bytes)
    require(index.get("schemaVersion") == 2 and index.get("mediaType") == INDEX_MEDIA_TYPE, "published digest is not an OCI image index")
    manifests = index.get("manifests")
    require(isinstance(manifests, list), "image index has no manifest list")
    runnable = [item for item in manifests if item.get("platform") == {"architecture": "amd64", "os": "linux"}]
    attestations = [item for item in manifests if item.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest"]
    require(len(runnable) == 1, "expected exactly one linux/amd64 image manifest")
    require(len(attestations) == 1, "expected exactly one BuildKit attestation manifest")
    image_descriptor, attestation_descriptor = runnable[0], attestations[0]
    checked_descriptor("image manifest", image_descriptor, {MANIFEST_MEDIA_TYPE})
    checked_descriptor("attestation manifest", attestation_descriptor, {MANIFEST_MEDIA_TYPE})
    image_digest = image_descriptor.get("digest")
    require(attestation_descriptor.get("platform") == {"architecture": "unknown", "os": "unknown"}, "attestation platform marker differs")
    require(attestation_descriptor.get("annotations", {}).get("vnd.docker.reference.digest") == image_digest, "attestation descriptor points to another image manifest")

    image_manifest_bytes = checked_fetch(client.manifest, "image manifest", image_descriptor)
    image_manifest = json.loads(image_manifest_bytes)
    require(image_manifest.get("schemaVersion") == 2 and image_manifest.get("mediaType") == MANIFEST_MEDIA_TYPE, "invalid runnable image manifest")
    config_descriptor = image_manifest.get("config")
    checked_descriptor("image config", config_descriptor, {CONFIG_MEDIA_TYPE})
    config_bytes = checked_fetch(client.blob, "image config", config_descriptor)
    config = json.loads(config_bytes)
    require(config.get("architecture") == "amd64" and config.get("os") == "linux", "image config platform differs")
    require(config.get("config", {}).get("User") == "101:101", "image runtime user differs")
    labels = config.get("config", {}).get("Labels", {})
    expected_labels = {
        "org.opencontainers.image.revision": source,
        "org.opencontainers.image.source": "https://github.com/hermawan22/varendo",
        "com.aeliqo.sdk.revision": sdk_revision,
        "com.aeliqo.sdk.version": sdk_version,
    }
    for key, expected in expected_labels.items():
        require(labels.get(key) == expected, f"image config label differs: {key}")
    image_layers = image_manifest.get("layers")
    require(isinstance(image_layers, list) and image_layers, "image manifest has no layers")
    for position, image_layer in enumerate(image_layers):
        checked_descriptor(f"image layer {position}", image_layer, LAYER_MEDIA_TYPES)

    attestation_bytes = checked_fetch(client.manifest, "attestation manifest", attestation_descriptor)
    attestation = json.loads(attestation_bytes)
    require(attestation.get("schemaVersion") == 2 and attestation.get("mediaType") == MANIFEST_MEDIA_TYPE, "invalid attestation manifest")
    require(attestation.get("artifactType") == ATTESTATION_ARTIFACT_TYPE, "attestation is not stored as the reviewed OCI artifact type")
    require(attestation.get("subject", {}).get("digest") == image_digest, "attestation manifest subject differs from image manifest")
    layers = attestation.get("layers")
    require(isinstance(layers, list) and len(layers) == 1, "expected one provenance layer")
    layer = layers[0]
    require(layer.get("mediaType") == IN_TOTO_MEDIA_TYPE, "provenance layer has wrong media type")
    require(layer.get("annotations", {}).get("in-toto.io/predicate-type") == PREDICATE_TYPE, "provenance layer has wrong predicate type")

    statement_bytes = checked_fetch(client.blob, "provenance layer", layer)
    statement = json.loads(statement_bytes)
    require(statement.get("_type") == STATEMENT_TYPE, "invalid in-toto statement type")
    require(statement.get("predicateType") == PREDICATE_TYPE, "invalid SLSA predicate type")
    subjects = statement.get("subject")
    require(isinstance(subjects, list) and len(subjects) == 1, "expected exactly one provenance subject")
    require(subjects[0].get("digest", {}).get("sha256") == image_digest.removeprefix("sha256:"), "provenance subject differs from image manifest")

    predicate = statement.get("predicate", {})
    definition = predicate.get("buildDefinition", {})
    require(definition.get("buildType") == BUILD_TYPE, "unexpected BuildKit provenance build type")
    external = definition.get("externalParameters", {})
    require(external.get("configSource", {}).get("path") == "Dockerfile", "provenance config source differs")
    request = external.get("request", {})
    require(request.get("frontend") == "dockerfile.v0", "provenance frontend differs")
    args = request.get("args", {})
    expected_args = {
        "build-arg:SOURCE_REVISION": source,
        "build-arg:SDK_SOURCE_REVISION": sdk_revision,
        "build-arg:SDK_VERSION": sdk_version,
        "label:org.opencontainers.image.revision": source,
        "label:org.opencontainers.image.source": "https://github.com/hermawan22/varendo",
        "label:com.aeliqo.sdk.revision": sdk_revision,
        "label:com.aeliqo.sdk.version": sdk_version,
    }
    for key, expected in expected_args.items():
        require(args.get(key) == expected, f"provenance argument differs: {key}")
    internal = definition.get("internalParameters", {})
    require(internal.get("builderPlatform") == "linux/amd64", "provenance builder platform differs")
    details = predicate.get("runDetails", {})
    require(details.get("builder", {}).get("id") == builder_id, "provenance builder ID differs")
    metadata = details.get("metadata", {})
    require(metadata.get("buildkit_completeness", {}).get("request") is True, "provenance request is incomplete")
    vcs = metadata.get("buildkit_metadata", {}).get("vcs", {})
    require(vcs.get("source") == "https://github.com/hermawan22/varendo", "provenance VCS source differs")
    require(vcs.get("revision") == source, "provenance VCS revision differs")
    require(vcs.get("localdir:context") == ".", "provenance build context differs")
    require(vcs.get("localdir:dockerfile") == "apps/site", "provenance Dockerfile directory differs")

    return statement_bytes, {
        "schemaVersion": 1,
        "indexDigest": index_digest,
        "subjectDigest": image_digest,
        "imageManifestDigest": image_descriptor["digest"],
        "imageConfigDigest": config_descriptor["digest"],
        "imageLayerCount": len(image_layers),
        "attestationManifestDigest": attestation_descriptor["digest"],
        "statementDigest": digest_bytes(statement_bytes),
        "predicateType": PREDICATE_TYPE,
        "builderId": builder_id,
        "sourceRevision": source,
        "sdkRevision": sdk_revision,
        "sdkVersion": sdk_version,
        "verified": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--index-digest", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--sdk-revision", required=True)
    parser.add_argument("--sdk-version", required=True)
    parser.add_argument("--builder-id", required=True)
    parser.add_argument("--statement-output", required=True)
    parser.add_argument("--summary-output", required=True)
    args = parser.parse_args()
    client = GhcrClient(args.repository, os.environ["GH_ACTOR"], os.environ["GH_TOKEN"])
    statement, summary = verify_graph(client, args.index_digest, args.source, args.sdk_revision, args.sdk_version, args.builder_id)
    Path(args.statement_output).write_bytes(statement + (b"" if statement.endswith(b"\n") else b"\n"))
    Path(args.summary_output).write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
