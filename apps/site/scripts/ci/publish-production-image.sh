#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
cd "$(git rev-parse --show-toplevel)"

: "${GH_TOKEN:?}" "${GH_ACTOR:?}" "${GH_TRIGGERING_ACTOR:?}" "${GH_REPO:?}"
: "${SOURCE_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}" "${RUNNER_TEMP:?}"
: "${AELIQO_EXPORT_VERIFIED_VERSION:?}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
[[ "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
test "$GH_REPO" = "hermawan22/varendo"
test "$GH_ACTOR" = "hermawan22"
test "$GH_TRIGGERING_ACTOR" = "hermawan22"
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
verify_current_main() {
	local branch_sha
	branch_sha="$(curl --fail --silent --show-error --location \
		--header "Authorization: Bearer $GH_TOKEN" \
		--header 'Accept: application/vnd.github+json' \
		--header 'X-GitHub-Api-Version: 2022-11-28' \
		"https://api.github.com/repos/$GH_REPO/branches/main" | \
		jq -er '.commit.sha | select(test("^[0-9a-f]{40}$"))')"
	test "$branch_sha" = "$SOURCE_SHA"
}
verify_current_main
git diff --quiet
git diff --cached --quiet

sdk_revision="$SOURCE_SHA"
# The registry artifacts are bound to the revision that published the packages;
# a site-only redeploy binds them to the earlier published source instead.
registry_source="${AELIQO_REGISTRY_SOURCE:-$SOURCE_SHA}"
[[ "$registry_source" =~ ^[0-9a-f]{40}$ ]]
release_version="$(jq -er '.version | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' release-metadata.json)"
sdk_version="$(jq -er --arg version "$release_version" '.version | select(. == $version)' packages/core/package.json)"
test "$AELIQO_EXPORT_VERIFIED_VERSION" = "$release_version"
jq -e --arg version "$release_version" --arg sha "$registry_source" \
  '.version == $version and .expectedSourceRevision == $sha and .provenanceVerified == true and (.packages | length) == 5' \
  artifacts/site-release-policy/registry-consumer.json >/dev/null
jq -e --arg version "$release_version" --arg sha "$registry_source" \
  '.schema == "aeliqo.export-registry.v1" and .status == "passed" and .version == $version and .sourceRevision == $sha and
   (.scenarios | length) == 4 and ([.scenarios[].build] | all(. == "passed")) and
   (.tags | length) == 5 and ([.tags[]] | all(. == $version))' \
  artifacts/site-release-policy/export-consumer.json >/dev/null

image="ghcr.io/hermawan22/varendo-web"
tag="${SOURCE_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
reference="$image:$tag"
quarantine_reference="$image:quarantine-$tag"
output="apps/site/artifacts/production-image"
mkdir -p "$output"

docker_config="$(mktemp -d "$RUNNER_TEMP/aeliqo-registry.XXXXXX")"
trivy_dir="$(mktemp -d "$RUNNER_TEMP/aeliqo-trivy.XXXXXX")"
export DOCKER_CONFIG="$docker_config"

python3 - <<'PY'
import base64
import json
import os
from pathlib import Path

credential = base64.b64encode(f"{os.environ['GH_ACTOR']}:{os.environ['GH_TOKEN']}".encode()).decode()
Path(os.environ["DOCKER_CONFIG"], "config.json").write_text(
    json.dumps({"auths": {"ghcr.io": {"auth": credential}}})
)
PY

trap 'rm -rf "$docker_config" "$trivy_dir"' EXIT

# The candidate tag cannot match Flux's source-run-attempt policy. The final
# unique tag is published only after this exact index passes every gate.
builder_id="https://github.com/$GH_REPO/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT"
builder_name="varendo-web-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
docker buildx create --name "$builder_name" --driver docker-container --use >/dev/null
trap 'docker buildx rm --force "$builder_name" >/dev/null 2>&1 || true; rm -rf "$docker_config" "$trivy_dir"' EXIT
docker buildx build \
	--platform linux/amd64 \
	--build-arg "SOURCE_REVISION=$SOURCE_SHA" \
	--build-arg "SDK_SOURCE_REVISION=$sdk_revision" \
	--build-arg "SDK_VERSION=$sdk_version" \
	--build-arg "AELIQO_EXPORT_VERIFIED_VERSION=$AELIQO_EXPORT_VERIFIED_VERSION" \
	--label "org.opencontainers.image.revision=$SOURCE_SHA" \
	--label "org.opencontainers.image.source=https://github.com/$GH_REPO" \
	--label "com.aeliqo.sdk.revision=$sdk_revision" \
	--label "com.aeliqo.sdk.version=$sdk_version" \
	--attest "type=provenance,mode=max,builder-id=$builder_id" \
	--output "type=image,name=$quarantine_reference,push=true,oci-mediatypes=true,oci-artifact=true" \
	--metadata-file "$output/build-metadata.json" \
	--file apps/site/Dockerfile \
	.

digest="$(jq -er '."containerimage.digest" | select(test("^sha256:[0-9a-f]{64}$"))' "$output/build-metadata.json")"
jq -e --arg digest "$digest" \
	'."containerimage.descriptor".digest == $digest' \
	"$output/build-metadata.json" >/dev/null

python3 apps/site/scripts/ci/verify-buildkit-provenance.py \
	--repository "$image" \
	--index-digest "$digest" \
	--source "$SOURCE_SHA" \
	--sdk-revision "$sdk_revision" \
	--sdk-version "$sdk_version" \
	--builder-id "$builder_id" \
	--statement-output "$output/provenance.intoto.json" \
	--summary-output "$output/provenance-summary.json"
jq -e \
	'.imageConfigDigest | strings | test("^sha256:[0-9a-f]{64}$")' \
	"$output/provenance-summary.json" >/dev/null
subject_digest="$(jq -er '.subjectDigest | select(test("^sha256:[0-9a-f]{64}$"))' "$output/provenance-summary.json")"
statement_digest="$(jq -er '.statementDigest | select(test("^sha256:[0-9a-f]{64}$"))' "$output/provenance-summary.json")"
curl --fail --silent --show-error --location \
	"https://github.com/aquasecurity/trivy/releases/download/v0.74.0/trivy_0.74.0_Linux-64bit.tar.gz" \
	--output "$trivy_dir/trivy.tar.gz"
echo "2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a  $trivy_dir/trivy.tar.gz" | sha256sum -c -
tar -xzf "$trivy_dir/trivy.tar.gz" -C "$trivy_dir" trivy

export TRIVY_USERNAME="$GH_ACTOR"
export TRIVY_PASSWORD="$GH_TOKEN"
export TRIVY_CACHE_DIR="$RUNNER_TEMP/aeliqo-trivy-cache"
mkdir -p "$TRIVY_CACHE_DIR"
"$trivy_dir/trivy" image \
	--scanners vuln \
	--format cyclonedx \
	--output "$output/sbom.cdx.json" \
	"$image@$digest"
"$trivy_dir/trivy" image \
	--scanners vuln \
	--format json \
	--output "$output/trivy-high-critical.json" \
	--severity HIGH,CRITICAL \
	--exit-code 1 \
	"$image@$digest"

# A single OCI index source is copied without reconstructing its manifests or
# attestations. Never use the mutable candidate tag as the promotion source.
verify_current_main
docker buildx imagetools create \
	--prefer-index=false \
	--metadata-file "$output/promotion-metadata.json" \
	--tag "$reference" \
	"$image@$digest"
jq -e --arg digest "$digest" --arg image "$image" \
	'."containerimage.descriptor".digest == $digest and
	 ."containerimage.descriptor".mediaType == "application/vnd.oci.image.index.v1+json" and
	 ."image.name" == $image' \
	"$output/promotion-metadata.json" >/dev/null
docker buildx imagetools inspect "$reference" --format '{{json .Manifest}}' > "$output/registry-index.json"
jq -e --arg digest "$digest" \
	'.digest == $digest and .mediaType == "application/vnd.oci.image.index.v1+json"' \
	"$output/registry-index.json" >/dev/null

jq -n \
	--arg image "$image" \
	--arg tag "$tag" \
	--arg digest "$digest" \
	--arg revision "$SOURCE_SHA" \
	--arg sdkRevision "$sdk_revision" \
	--arg sdkVersion "$sdk_version" \
	--arg builderId "$builder_id" \
	--arg subjectDigest "$subject_digest" \
	--arg statementDigest "$statement_digest" \
	'{schemaVersion:2,image:$image,tag:$tag,digest:$digest,siteRevision:$revision,sdkRevision:$sdkRevision,sdkVersion:$sdkVersion,reference:($image+"@"+$digest),builderId:$builderId,provenance:{format:"https://slsa.dev/provenance/v1",storage:"attached OCI attestation",verifiedFromRegistry:true,subjectDigest:$subjectDigest,statementDigest:$statementDigest}}' \
	> "$output/image.json"

(
	cd "$output"
	sha256sum \
		build-metadata.json \
		promotion-metadata.json \
		registry-index.json \
		image.json \
		provenance-summary.json \
		provenance.intoto.json \
		sbom.cdx.json \
		trivy-high-critical.json \
		> SHA256SUMS
)
