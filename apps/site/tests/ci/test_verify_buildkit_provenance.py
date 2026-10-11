import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "provenance", ROOT / "scripts/ci/verify-buildkit-provenance.py"
)
PROVENANCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROVENANCE)

SOURCE = "1" * 40
SDK_REVISION = "2" * 40
SDK_VERSION = "0.1.0"
BUILDER_ID = "https://github.com/hermawan22/varendo/actions/runs/123/attempts/1"
def encoded(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def descriptor(value, **extra):
    return {
        "mediaType": extra.pop("mediaType", PROVENANCE.MANIFEST_MEDIA_TYPE),
        "digest": PROVENANCE.digest_bytes(value),
        "size": len(value),
        **extra,
    }


class FixtureClient:
    def __init__(self, manifests, blobs):
        self.manifests = manifests
        self.blobs = blobs

    def manifest(self, digest):
        return self.manifests[digest]

    def blob(self, digest):
        return self.blobs[digest]


class FakeResponse:
    def __init__(self, value, url="https://ghcr.io/v2/example", headers=None):
        self.value = value
        self.url = url
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def geturl(self):
        return self.url

    def read(self, limit):
        return self.value[:limit]


def fixture(statement_change=None):
    config = {
        "architecture": "amd64",
        "os": "linux",
        "config": {
            "User": "101:101",
            "Labels": {
                "org.opencontainers.image.revision": SOURCE,
                "org.opencontainers.image.source": "https://github.com/hermawan22/varendo",
                "com.aeliqo.sdk.revision": SDK_REVISION,
                "com.aeliqo.sdk.version": SDK_VERSION,
            },
        },
    }
    config_bytes = encoded(config)
    config_descriptor = descriptor(
        config_bytes, mediaType=PROVENANCE.CONFIG_MEDIA_TYPE
    )
    image_layer = {
        "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
        "digest": "sha256:" + "3" * 64,
        "size": 1234,
    }
    image_manifest = {
        "schemaVersion": 2,
        "mediaType": PROVENANCE.MANIFEST_MEDIA_TYPE,
        "config": config_descriptor,
        "layers": [image_layer],
    }
    image_manifest_bytes = encoded(image_manifest)
    image_descriptor = descriptor(
        image_manifest_bytes,
        platform={"architecture": "amd64", "os": "linux"},
    )
    image_digest = image_descriptor["digest"]

    statement = {
        "_type": PROVENANCE.STATEMENT_TYPE,
        "predicateType": PROVENANCE.PREDICATE_TYPE,
        "subject": [{"name": "pkg:docker/aeliqo-web", "digest": {"sha256": image_digest.removeprefix("sha256:")}}],
        "predicate": {
            "buildDefinition": {
                "buildType": PROVENANCE.BUILD_TYPE,
                "externalParameters": {
                    "configSource": {"path": "Dockerfile"},
                    "request": {
                        "frontend": "dockerfile.v0",
                        "args": {
                            "build-arg:SOURCE_REVISION": SOURCE,
                            "build-arg:SDK_SOURCE_REVISION": SDK_REVISION,
                            "build-arg:SDK_VERSION": SDK_VERSION,
                            "label:org.opencontainers.image.revision": SOURCE,
                            "label:org.opencontainers.image.source": "https://github.com/hermawan22/varendo",
                            "label:com.aeliqo.sdk.revision": SDK_REVISION,
                            "label:com.aeliqo.sdk.version": SDK_VERSION,
                        },
                    },
                },
                "internalParameters": {"builderPlatform": "linux/amd64"},
            },
            "runDetails": {
                "builder": {"id": BUILDER_ID},
                "metadata": {
                    "buildkit_completeness": {"request": True},
                    "buildkit_metadata": {
                        "vcs": {
                            "source": "https://github.com/hermawan22/varendo",
                            "revision": SOURCE,
                            "localdir:context": ".",
                            "localdir:dockerfile": "apps/site",
                        }
                    },
                },
            },
        },
    }
    if statement_change:
        statement_change(statement)
    statement_bytes = encoded(statement)
    layer = descriptor(
        statement_bytes,
        mediaType=PROVENANCE.IN_TOTO_MEDIA_TYPE,
        annotations={"in-toto.io/predicate-type": PROVENANCE.PREDICATE_TYPE},
    )
    attestation = {
        "schemaVersion": 2,
        "mediaType": PROVENANCE.MANIFEST_MEDIA_TYPE,
        "artifactType": PROVENANCE.ATTESTATION_ARTIFACT_TYPE,
        "config": {},
        "subject": {"digest": image_digest},
        "layers": [layer],
    }
    attestation_bytes = encoded(attestation)
    attestation_descriptor = descriptor(
        attestation_bytes,
        platform={"architecture": "unknown", "os": "unknown"},
        annotations={
            "vnd.docker.reference.type": "attestation-manifest",
            "vnd.docker.reference.digest": image_digest,
        },
    )
    index = {
        "schemaVersion": 2,
        "mediaType": PROVENANCE.INDEX_MEDIA_TYPE,
        "manifests": [image_descriptor, attestation_descriptor],
    }
    index_bytes = encoded(index)
    index_digest = PROVENANCE.digest_bytes(index_bytes)
    return FixtureClient(
        {
            index_digest: index_bytes,
            image_descriptor["digest"]: image_manifest_bytes,
            attestation_descriptor["digest"]: attestation_bytes,
        },
        {
            config_descriptor["digest"]: config_bytes,
            layer["digest"]: statement_bytes,
        },
    ), index_digest


class ProvenanceTests(unittest.TestCase):
    def verify(self, client, digest):
        return PROVENANCE.verify_graph(
            client, digest, SOURCE, SDK_REVISION, SDK_VERSION, BUILDER_ID
        )

    def test_exact_buildkit_provenance_is_accepted(self):
        client, digest = fixture()
        statement, summary = self.verify(client, digest)
        self.assertEqual(summary["indexDigest"], digest)
        self.assertEqual(summary["subjectDigest"], summary["imageManifestDigest"])
        self.assertIn(summary["imageConfigDigest"], client.blobs)
        self.assertEqual(
            PROVENANCE.digest_bytes(client.blobs[summary["imageConfigDigest"]]),
            summary["imageConfigDigest"],
        )
        self.assertEqual(summary["imageLayerCount"], 1)
        self.assertEqual(summary["statementDigest"], PROVENANCE.digest_bytes(statement))
        self.assertTrue(summary["verified"])

    def test_wrong_builder_or_source_is_rejected(self):
        changes = [
            lambda value: value["predicate"]["runDetails"]["builder"].update(id="https://example.invalid/builder"),
            lambda value: value["predicate"]["runDetails"]["metadata"]["buildkit_metadata"]["vcs"].update(revision="4" * 40),
            lambda value: value["predicate"]["runDetails"]["metadata"]["buildkit_metadata"]["vcs"].update({"localdir:context": "apps"}),
            lambda value: value["predicate"]["runDetails"]["metadata"]["buildkit_metadata"]["vcs"].update({"localdir:dockerfile": "site"}),
        ]
        for change in changes:
            with self.subTest(change=change):
                client, digest = fixture(change)
                with self.assertRaises(ValueError):
                    self.verify(client, digest)

    def test_wrong_sdk_or_subject_is_rejected(self):
        changes = [
            lambda value: value["predicate"]["buildDefinition"]["externalParameters"]["request"]["args"].update({"build-arg:SDK_VERSION": "0.1.0-rc.9"}),
            lambda value: value["subject"][0]["digest"].update(sha256="5" * 64),
        ]
        for change in changes:
            with self.subTest(change=change):
                client, digest = fixture(change)
                with self.assertRaises(ValueError):
                    self.verify(client, digest)

    def test_missing_or_misdirected_attestation_is_rejected(self):
        client, digest = fixture()
        index = json.loads(client.manifests[digest])
        for mutation in (
            lambda value: value["manifests"].pop(),
            lambda value: value["manifests"][1]["annotations"].update({"vnd.docker.reference.digest": "sha256:" + "6" * 64}),
        ):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(index)
                mutation(changed)
                changed_bytes = encoded(changed)
                changed_digest = PROVENANCE.digest_bytes(changed_bytes)
                changed_client = copy.copy(client)
                changed_client.manifests = {**client.manifests, changed_digest: changed_bytes}
                with self.assertRaises(ValueError):
                    self.verify(changed_client, changed_digest)

    def test_missing_or_malformed_runnable_manifest_is_rejected(self):
        client, digest = fixture()
        index = json.loads(client.manifests[digest])
        image_descriptor = index["manifests"][0]
        mutations = (
            lambda value: value["manifests"].pop(0),
            lambda value: value["manifests"][0].update(size=1),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(index)
                mutation(changed)
                changed_bytes = encoded(changed)
                changed_digest = PROVENANCE.digest_bytes(changed_bytes)
                changed_client = copy.copy(client)
                changed_client.manifests = {
                    **client.manifests,
                    changed_digest: changed_bytes,
                }
                with self.assertRaises(ValueError):
                    self.verify(changed_client, changed_digest)

        malformed = json.loads(client.manifests[image_descriptor["digest"]])
        malformed["config"]["mediaType"] = "application/octet-stream"
        malformed_bytes = encoded(malformed)
        malformed_descriptor = descriptor(
            malformed_bytes,
            platform={"architecture": "amd64", "os": "linux"},
        )
        changed_index = copy.deepcopy(index)
        changed_index["manifests"][0] = malformed_descriptor
        changed_index["manifests"][1]["annotations"][
            "vnd.docker.reference.digest"
        ] = malformed_descriptor["digest"]
        changed_index_bytes = encoded(changed_index)
        changed_digest = PROVENANCE.digest_bytes(changed_index_bytes)
        changed_client = copy.copy(client)
        changed_client.manifests = {
            **client.manifests,
            changed_digest: changed_index_bytes,
            malformed_descriptor["digest"]: malformed_bytes,
        }
        with self.assertRaises(ValueError):
            self.verify(changed_client, changed_digest)


class GhcrClientTests(unittest.TestCase):
    def test_token_exchange_and_manifest_fetch_are_bounded_and_authenticated(self):
        manifest = b'{"schemaVersion":2}'
        token = FakeResponse(
            b'{"token":"registry-token"}',
            "https://ghcr.io/token?service=ghcr.io",
        )
        payload = FakeResponse(manifest)
        with mock.patch.object(
            PROVENANCE.urllib.request, "urlopen", side_effect=[token, payload]
        ) as opener:
            client = PROVENANCE.GhcrClient(
                "ghcr.io/hermawan22/varendo-web", "owner", "credential"
            )
            value = client.manifest("sha256:" + "a" * 64)

        self.assertEqual(value, manifest)
        token_request = opener.call_args_list[0].args[0]
        manifest_request = opener.call_args_list[1].args[0]
        self.assertIn("scope=repository%3Ahermawan22%2Fvarendo-web%3Apull", token_request.full_url)
        self.assertTrue(token_request.get_header("Authorization").startswith("Basic "))
        self.assertEqual(manifest_request.get_header("Authorization"), "Bearer registry-token")
        self.assertIn(PROVENANCE.INDEX_MEDIA_TYPE, manifest_request.get_header("Accept"))
        self.assertEqual(opener.call_args_list[0].kwargs["timeout"], 30)
        self.assertEqual(opener.call_args_list[1].kwargs["timeout"], 30)

    def test_trusted_https_blob_redirect_is_accepted(self):
        response = FakeResponse(
            b"blob",
            "https://pkg-containers.githubusercontent.com/ghcr/redirected-blob",
        )
        with mock.patch.object(PROVENANCE.urllib.request, "urlopen", return_value=response):
            self.assertEqual(
                PROVENANCE.GhcrClient._read(
                    PROVENANCE.urllib.request.Request("https://ghcr.io/v2/example")
                ),
                b"blob",
            )

    def test_untrusted_redirect_and_oversized_response_are_rejected(self):
        cases = (
            FakeResponse(b"payload", "https://example.invalid/stolen"),
            FakeResponse(b"payload", "https://evil.githubusercontent.com/stolen"),
            FakeResponse(b"payload", "https://evil.blob.core.windows.net/stolen"),
            FakeResponse(
                b"",
                headers={"Content-Length": str(PROVENANCE.MAX_RESPONSE + 1)},
            ),
        )
        for response in cases:
            with self.subTest(url=response.url, headers=response.headers):
                with mock.patch.object(
                    PROVENANCE.urllib.request, "urlopen", return_value=response
                ):
                    with self.assertRaises(ValueError):
                        PROVENANCE.GhcrClient._read(
                            PROVENANCE.urllib.request.Request(
                                "https://ghcr.io/v2/example"
                            )
                        )


if __name__ == "__main__":
    unittest.main()
