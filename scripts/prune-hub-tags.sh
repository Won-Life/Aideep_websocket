#!/usr/bin/env bash
set -euo pipefail

REPO_FULL="$1"
BRANCH="$2"
KEEP="${3:-3}"

NS="${REPO_FULL%%/*}"
REPO="${REPO_FULL##*/}"

: "${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME is required}"
: "${DOCKERHUB_TOKEN:?DOCKERHUB_TOKEN is required}"

TOKEN=$(
  curl -s -H 'Content-Type: application/json' \
    -d "$(jq -n --arg u "$DOCKERHUB_USERNAME" --arg p "$DOCKERHUB_TOKEN" '{username:$u, password:$p}')" \
    https://hub.docker.com/v2/users/login/ \
    | jq -r '.token'
)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Docker Hub login failed" >&2
  exit 1
fi

OLD_TAGS=()
while IFS= read -r tag; do
  [ -n "$tag" ] && OLD_TAGS+=("$tag")
done < <(
  curl -s -H "Authorization: JWT $TOKEN" \
    "https://hub.docker.com/v2/repositories/${NS}/${REPO}/tags/?page_size=100" \
    | jq -r --arg pfx "${BRANCH}-" --argjson keep "$KEEP" '
        .results
        | map(select(.name | startswith($pfx)))
        | sort_by(.last_updated) | reverse
        | .[$keep:]
        | .[].name
      '
)

if [ "${#OLD_TAGS[@]}" -eq 0 ]; then
  echo "No old Hub tags to prune for prefix: ${BRANCH}-"
  exit 0
fi

for tag in "${OLD_TAGS[@]}"; do
  echo "Deleting Hub tag: ${NS}/${REPO}:${tag}"
  curl -s -X DELETE -H "Authorization: JWT $TOKEN" \
    "https://hub.docker.com/v2/repositories/${NS}/${REPO}/tags/${tag}/" >/dev/null
done
