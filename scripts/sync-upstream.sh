#!/usr/bin/env bash
set -euo pipefail

DEFAULT_UPSTREAM_URL="https://github.com/infinitel8p/Extreme-InfiniTV.git"

fork_remote="origin"
upstream_remote="upstream"
branch="main"
mode="check"
strategy="ff-only"
setup_upstream="false"
push_fork="false"
upstream_url="$DEFAULT_UPSTREAM_URL"

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-upstream.sh [options]

Checks whether the local fork is aligned with the upstream project and, when
requested, updates the current branch from upstream.

Default mode is read-only.

Options:
  --check                 Fetch remotes and report ahead/behind status (default)
  --apply                 Update the current branch from upstream when possible
  --setup-upstream        Add the upstream remote if it is missing
  --push                  After a successful apply, push the branch to origin
  --strategy <strategy>   ff-only, merge, or rebase (default: ff-only)
  --branch <name>         Upstream branch to track (default: main)
  --fork <remote>         Fork remote name (default: origin)
  --upstream <remote>     Upstream remote name (default: upstream)
  --upstream-url <url>    URL used by --setup-upstream
  -h, --help              Show this help

Examples:
  scripts/sync-upstream.sh --setup-upstream --check
  scripts/sync-upstream.sh --apply
  scripts/sync-upstream.sh --apply --strategy rebase
  scripts/sync-upstream.sh --apply --push
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      mode="check"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --setup-upstream)
      setup_upstream="true"
      shift
      ;;
    --push)
      push_fork="true"
      shift
      ;;
    --strategy)
      strategy="${2:-}"
      shift 2
      ;;
    --branch)
      branch="${2:-}"
      shift 2
      ;;
    --fork)
      fork_remote="${2:-}"
      shift 2
      ;;
    --upstream)
      upstream_remote="${2:-}"
      shift 2
      ;;
    --upstream-url)
      upstream_url="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$branch" || -z "$fork_remote" || -z "$upstream_remote" ]]; then
  echo "Branch and remote names cannot be empty." >&2
  exit 2
fi

case "$strategy" in
  ff-only|merge|rebase) ;;
  *)
    echo "Invalid --strategy '$strategy'. Use ff-only, merge, or rebase." >&2
    exit 2
    ;;
esac

git rev-parse --is-inside-work-tree >/dev/null

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  echo "Detached HEAD detected. Check out a branch before syncing." >&2
  exit 1
fi

if ! git remote get-url "$fork_remote" >/dev/null 2>&1; then
  echo "Fork remote '$fork_remote' is missing." >&2
  exit 1
fi

if ! git remote get-url "$upstream_remote" >/dev/null 2>&1; then
  if [[ "$setup_upstream" == "true" ]]; then
    echo "Adding upstream remote '$upstream_remote' -> $upstream_url"
    git remote add "$upstream_remote" "$upstream_url"
  else
    cat >&2 <<EOF
Upstream remote '$upstream_remote' is missing.
Run:
  scripts/sync-upstream.sh --setup-upstream --check
or add it manually:
  git remote add $upstream_remote $upstream_url
EOF
    exit 1
  fi
fi

if [[ "$mode" == "apply" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Commit or stash local changes before --apply." >&2
    git status --short >&2
    exit 1
  fi
fi

echo "Fetching '$fork_remote' and '$upstream_remote'..."
git fetch --prune "$fork_remote"
git fetch --prune "$upstream_remote"

upstream_ref="$upstream_remote/$branch"
fork_ref="$fork_remote/$branch"

if ! git rev-parse --verify --quiet "$upstream_ref" >/dev/null; then
  echo "Upstream ref '$upstream_ref' does not exist." >&2
  exit 1
fi

if git rev-parse --verify --quiet "$fork_ref" >/dev/null; then
  read -r fork_behind fork_ahead < <(git rev-list --left-right --count "$upstream_ref...$fork_ref")
else
  fork_behind="?"
  fork_ahead="?"
fi

read -r local_behind local_ahead < <(git rev-list --left-right --count "$upstream_ref...HEAD")

echo
echo "Branch:          $current_branch"
echo "Upstream target: $upstream_ref"
echo "Fork target:     $fork_ref"
echo "Local status:    behind upstream by $local_behind, ahead by $local_ahead"
echo "Fork status:     behind upstream by $fork_behind, ahead by $fork_ahead"

if [[ "$mode" == "check" ]]; then
  if [[ "$local_behind" == "0" && "$local_ahead" == "0" ]]; then
    echo "Result: local branch is aligned with upstream."
  else
    echo "Result: updates or local-only commits exist. Re-run with --apply to align."
  fi
  exit 0
fi

if [[ "$current_branch" != "$branch" ]]; then
  echo "Current branch is '$current_branch', but upstream target branch is '$branch'." >&2
  echo "Check out '$branch' or pass --branch '$current_branch' intentionally." >&2
  exit 1
fi

if [[ "$local_behind" == "0" ]]; then
  echo "No upstream commits to apply."
else
  case "$strategy" in
    ff-only)
      if [[ "$local_ahead" != "0" ]]; then
        cat >&2 <<EOF
Cannot fast-forward: local branch has $local_ahead commit(s) not in upstream.
Use --strategy rebase or --strategy merge after reviewing the local commits.
EOF
        exit 1
      fi
      git merge --ff-only "$upstream_ref"
      ;;
    merge)
      git merge --no-edit "$upstream_ref"
      ;;
    rebase)
      git rebase "$upstream_ref"
      ;;
  esac
fi

if [[ "$push_fork" == "true" ]]; then
  git push "$fork_remote" "$current_branch:$branch"
fi

echo "Sync complete."
