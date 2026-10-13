#!/usr/bin/env sh
set -eu

image="${1:?usage: check-static-image.sh IMAGE [REVISION]}"
revision="${2:-unknown}"
sdk_revision="${3:-unknown}"
sdk_version="${4:-unknown}"
container="varendo-static-$$"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/varendo-image-check.XXXXXX")"

test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$revision"

cleanup() {
	docker rm --force "$container" >/dev/null 2>&1 || true
	rm -rf "$temp_dir"
}
trap cleanup EXIT INT TERM

docker run --detach --rm --name "$container" -p 127.0.0.1::8080 "$image" >/dev/null
port="$(docker port "$container" 8080/tcp | sed 's/.*://')"
base="http://127.0.0.1:$port"

attempt=1
while [ "$attempt" -le 30 ]; do
  if curl --fail --silent "$base/readyz" | grep -qx '{"status":"ready"}'; then
    break
  fi
  if [ "$attempt" = 30 ]; then
    echo "static image never became ready" >&2
    exit 1
  fi
  sleep 1
  attempt=$((attempt + 1))
done

curl --fail --silent "$base/healthz" | grep -qx '{"status":"ok"}'
version="$(curl --fail --silent "$base/version")"
printf '%s\n' "$version" | grep -Fq '"product":"varendo-site"'
printf '%s\n' "$version" | grep -Fq '"siteRevision":"'"$revision"'"'
printf '%s\n' "$version" | grep -Fq '"sdkRevision":"'"$sdk_revision"'"'
printf '%s\n' "$version" | grep -Fq '"sdkVersion":"'"$sdk_version"'"'

headers="$(curl --fail --silent --head "$base/")"
printf '%s\n' "$headers" | grep -qi '^cache-control: no-cache, no-transform'
printf '%s\n' "$headers" | grep -qi "^content-security-policy: default-src 'self'"
printf '%s\n' "$headers" | grep -qi '^x-content-type-options: nosniff'

playground_headers="$(curl --fail --silent --head --header 'Host: docs.localhost' "$base/playground/")"
playground_csp="$(printf '%s\n' "$playground_headers" | tr -d '\r' | sed -n 's/^[Cc]ontent-Security-Policy: *//p')"
expected_playground_csp="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'"
if [ "$playground_csp" != "$expected_playground_csp" ]; then
	echo "hosted Playground CSP does not match the trusted-runner policy" >&2
	exit 1
fi

curl --fail --silent "$base/" > "$temp_dir/index.html"
assets="$(grep -Eo '/assets/[^"?[:space:]]+\.(js|css)' "$temp_dir/index.html" | sort -u)"
test -n "$assets"
printf '%s\n' "$assets" | while IFS= read -r asset; do
	test -n "$asset"
	curl --fail --silent --head "$base$asset" | grep -qi '^cache-control: public, max-age=31536000, immutable'
done

status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/not-a-route")"
test "$status" = 404

# SIGTERM must make readiness fail while the listener remains available for the
# five-second load-balancer drain window. The server must then stop inside the
# 30-second Kubernetes termination grace period.
docker kill --signal TERM "$container" >/dev/null
draining=false
attempt=1
while [ "$attempt" -le 40 ]; do
	status="$(curl --silent --output "$temp_dir/readyz.json" --write-out '%{http_code}' "$base/readyz" || true)"
	if [ "$status" = 503 ] && grep -qx '{"status":"draining"}' "$temp_dir/readyz.json"; then
		draining=true
		break
	fi
	sleep 0.1
	attempt=$((attempt + 1))
done
test "$draining" = true

stopped=false
attempt=1
while [ "$attempt" -le 300 ]; do
	if ! docker container inspect "$container" >/dev/null 2>&1; then
		stopped=true
		break
	fi
	sleep 0.1
	attempt=$((attempt + 1))
done
test "$stopped" = true
