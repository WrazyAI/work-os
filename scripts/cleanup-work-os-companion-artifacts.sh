#!/usr/bin/env bash

set -euo pipefail

repository="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
keep_count="${WORK_OS_COMPANION_ARTIFACT_KEEP_COUNT:-10}"
dry_run="${WORK_OS_COMPANION_ARTIFACT_DRY_RUN:-true}"
artifact_prefix="${WORK_OS_COMPANION_ARTIFACT_PREFIX:-work-os-companion-}"

if [[ -z "$repository" ]]; then
  echo "GH_REPO or GITHUB_REPOSITORY is required" >&2
  exit 1
fi

if [[ ! "$keep_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "WORK_OS_COMPANION_ARTIFACT_KEEP_COUNT must be a positive integer" >&2
  exit 1
fi

case "$dry_run" in
  true|false) ;;
  *)
    echo "WORK_OS_COMPANION_ARTIFACT_DRY_RUN must be true or false" >&2
    exit 1
    ;;
esac

artifact_pages="$(mktemp)"
candidate_artifacts="$(mktemp)"
keep_shas="$(mktemp)"
stale_artifacts="$(mktemp)"
trap 'rm -f "$artifact_pages" "$candidate_artifacts" "$keep_shas" "$stale_artifacts"' EXIT

gh api \
  --paginate \
  --slurp \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/$repository/actions/artifacts?per_page=100" > "$artifact_pages"

jq -c --arg prefix "$artifact_prefix" '
  map(.artifacts[])
  | map(
      select(
        ((.name // "") as $name
          | ($name | startswith($prefix))
          and ($name | endswith("-unsigned-internal")))
        and (.expired != true)
        and (.workflow_run != null)
        and ((.workflow_run.head_sha // "") != "")
      )
    )
  | sort_by(.created_at)
  | reverse
' "$artifact_pages" > "$candidate_artifacts"

candidate_count="$(jq 'length' "$candidate_artifacts")"
if [[ "$candidate_count" == "0" ]]; then
  echo "No active Work OS Companion deployment artifacts found in $repository."
  exit 0
fi

# A push to main and its release tag can create two workflow runs for one
# deployment. Keep the newest distinct head SHAs, not merely the newest runs.
jq -r --argjson limit "$keep_count" '
  reduce .[] as $artifact
    ({seen: [], keep: []};
      ($artifact.workflow_run.head_sha // "") as $sha
      | if $sha == "" or ((.seen | index($sha)) != null) then .
        elif (.keep | length) < $limit then
          .seen += [$sha] | .keep += [$sha]
        else .
        end
    )
  | .keep[]
' "$candidate_artifacts" > "$keep_shas"

keep_count_actual="$(wc -l < "$keep_shas" | tr -d ' ')"
keep_json="$(jq -Rsc 'split("\n") | map(select(length > 0))' "$keep_shas")"
jq -r --argjson keep "$keep_json" '
  .[]
  | .workflow_run.head_sha as $sha
  | select(($keep | index($sha)) == null)
  | [(.id | tostring), .name, .created_at, $sha, ((.size_in_bytes // 0) | tostring)]
  | @tsv
' "$candidate_artifacts" > "$stale_artifacts"

stale_count="$(wc -l < "$stale_artifacts" | tr -d ' ')"
echo "Found $candidate_count active companion artifacts across $keep_count_actual kept deployment(s); stale artifacts: $stale_count."

deleted_count=0
while IFS=$'\t' read -r artifact_id artifact_name created_at head_sha size_in_bytes; do
  [[ -n "$artifact_id" ]] || continue
  if [[ "$dry_run" == "true" ]]; then
    echo "Would delete artifact $artifact_id ($artifact_name, $created_at, ${size_in_bytes} bytes, $head_sha)"
  else
    echo "Deleting artifact $artifact_id ($artifact_name, $created_at, ${size_in_bytes} bytes, $head_sha)"
    gh api \
      --silent \
      --method DELETE \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "/repos/$repository/actions/artifacts/$artifact_id"
    deleted_count=$((deleted_count + 1))
    sleep 0.2
  fi
done < "$stale_artifacts"

if [[ "$dry_run" == "true" ]]; then
  echo "Dry run complete; no artifacts were deleted."
else
  echo "Deleted $deleted_count stale companion artifact(s)."
fi
