# Fork alignment workflow

This repository is a local fork of `infinitel8p/Extreme-InfiniTV`. Keep the
fork aligned with upstream before starting meaningful work and again before
opening a pull request or distributing a build.

## Script

Use:

```bash
pnpm sync:upstream -- --check
```

The script is read-only by default. It fetches `origin` and `upstream`, then
reports whether the local branch and fork branch are ahead of or behind
`upstream/main`.

If the `upstream` remote is missing, configure it with:

```bash
pnpm sync:upstream -- --setup-upstream --check
```

The default upstream URL is:

```text
https://github.com/infinitel8p/Extreme-InfiniTV.git
```

## Applying updates

When the working tree is clean and the local branch has no fork-only commits,
fast-forward from upstream:

```bash
pnpm sync:upstream -- --apply
```

To also update the fork remote after a successful sync:

```bash
pnpm sync:upstream -- --apply --push
```

If the fork has local commits and upstream has moved, choose an explicit
strategy after reviewing the branch:

```bash
pnpm sync:upstream -- --apply --strategy rebase
pnpm sync:upstream -- --apply --strategy merge
```

Prefer `ff-only` for routine alignment of `main`. Use `rebase` for private
feature branches. Use `merge` only when preserving branch history is important.

## Safety rules

- `--apply` refuses to run with uncommitted changes.
- `ff-only` refuses to run when local commits would need replaying or merging.
- The script never creates commits by itself.
- The script never force-pushes.
- The current branch must match the target branch unless `--branch` is passed
  intentionally.

## Useful manual checks

```bash
git remote -v
git status --short
git log --oneline --decorate --graph --max-count=20
git rev-list --left-right --count upstream/main...HEAD
```

