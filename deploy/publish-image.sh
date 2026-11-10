#!/bin/sh
# Sourced by the Forgejo workflow. An existing tag must match both source and inputs.
publish_image() {
  publish_ref=$1
  shift
  publish_inputs=$(printf '%s\n' "$@" | sha256sum | cut -d ' ' -f 1)
  publish_error=$(mktemp)
  if docker manifest inspect "$publish_ref" > /dev/null 2> "$publish_error"; then
    rm -f "$publish_error"
    docker pull "$publish_ref" || return 1
    publish_revision=$(docker image inspect "$publish_ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}') || return 1
    publish_previous_inputs=$(docker image inspect "$publish_ref" --format '{{ index .Config.Labels "app.sorye.build-inputs" }}') || return 1
    if [ "$publish_revision" != "$FORGEJO_SHA" ] || [ "$publish_previous_inputs" != "$publish_inputs" ]; then
      echo "Existing image has different or unverified source/build inputs: $publish_ref" >&2
      return 1
    fi
    echo "Reusing verified image: $publish_ref"
  else
    # Authentication, connectivity and registry failures must never be treated as absence.
    if ! grep -Eqi 'manifest unknown|no such manifest' "$publish_error"; then
      cat "$publish_error" >&2
      rm -f "$publish_error"
      return 1
    fi
    rm -f "$publish_error"
    docker build "$@" --label "org.opencontainers.image.revision=$FORGEJO_SHA" \
      --label "app.sorye.build-inputs=$publish_inputs" --tag "$publish_ref" . || return 1
    docker push "$publish_ref" || return 1
  fi
  docker image inspect "$publish_ref" --format '{{json .RepoDigests}}'
}
