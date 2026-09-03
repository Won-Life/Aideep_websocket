#!/usr/bin/env bash
set -euo pipefail

REPO="$1"
BRANCH="$2"
KEEP="${3:-3}"

PREFIX="${REPO}:${BRANCH}-"

OLD_TAGS=()
while IFS= read -r tag; do
  [ -n "$tag" ] && OLD_TAGS+=("$tag")
done < <(
  docker images --format '{{.Repository}}:{{.Tag}}|{{.CreatedAt}}' \
    | awk -F'|' -v p="$PREFIX" 'index($1, p) == 1 {print $0}' \
    | sort -t'|' -k2 -r \
    | tail -n +"$((KEEP + 1))" \
    | awk -F'|' '{print $1}'
)

if [ "${#OLD_TAGS[@]}" -eq 0 ]; then
  echo "No old local tags to prune for prefix: $PREFIX"
else
  printf 'Removing local image: %s\n' "${OLD_TAGS[@]}"
  docker rmi -f "${OLD_TAGS[@]}" || true
fi

docker image prune -f >/dev/null
