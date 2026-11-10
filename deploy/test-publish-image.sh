#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./deploy/publish-image.sh
FORGEJO_SHA=review-sha
export FORGEJO_SHA
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

# Mock the registry and builder, preserving labels between calls like a real registry.
docker() {
  printf '%s\n' "$*" >> "$test_dir/calls"
  case "$1 $2" in
    'manifest inspect')
      if [ "${registry_error:-}" ]; then echo "$registry_error" >&2; return 1; fi
      if [ ! -f "$test_dir/published" ]; then echo 'manifest unknown' >&2; return 1; fi ;;
    'build --file')
      if [ "${build_failure:-}" ]; then return 1; fi
      printf '%s' "$FORGEJO_SHA" > "$test_dir/revision"
      printf '%s' "$publish_inputs" > "$test_dir/inputs" ;;
    'push example/review:sha')
      if [ "${push_failure:-}" ]; then return 1; fi
      touch "$test_dir/published" ;;
    'image inspect')
      case "$*" in
        *org.opencontainers.image.revision*) cat "$test_dir/revision" ;;
        *app.sorye.build-inputs*) cat "$test_dir/inputs" ;;
        *) echo '["example/review@sha256:review"]' ;;
      esac ;;
    'pull example/review:sha') ;;
    *) echo "Unexpected Docker call: $*" >&2; return 1 ;;
  esac
}
publish() { publish_image example/review:sha --file deploy/worker.Dockerfile; }
must_fail() {
  if "$@"; then echo "Expected failure: $*" >&2; exit 1; fi
}

build_failure=1
must_fail publish
test ! -f "$test_dir/published"
unset build_failure
push_failure=1
must_fail publish
test ! -f "$test_dir/published"
unset push_failure
publish
# A retry after later release steps fail must reuse this successful publication.
publish
test "$(grep -c '^build ' "$test_dir/calls")" = 3
test "$(grep -c '^push ' "$test_dir/calls")" = 2
must_fail publish_image example/review:sha --file different.Dockerfile
printf '%s' wrong-sha > "$test_dir/revision"
must_fail publish
for registry_error in 'unauthorized: authentication required' 'connection refused' 'registry returned 500'; do
  must_fail publish
done
test "$(grep -c '^build ' "$test_dir/calls")" = 3
echo 'Publication recovery, source/input checks and registry failure tests passed.'
