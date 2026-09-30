#!/bin/bash
# Make a scratch worktree for a parallel helper: scripts/worktree.sh <name>  ->  ../wt/<name> on a local branch wt/<name>
# (based on the current branch, node_modules symlinked, the saved reference block copied so every capture shows the same town).
# Helpers commit locally; only the session branch is ever pushed.
set -e
name="$1"; root="$(cd "$(dirname "$0")/.." && pwd)"; dir="$root/../wt/$name"
mkdir -p "$root/../wt"
git -C "$root" worktree add -q -B "wt/$name" "$dir" HEAD
ln -sfn "$root/node_modules" "$dir/node_modules"
mkdir -p "$dir/shots/lookbook"
cp "$root"/shots/lookbook/town*.json "$dir/shots/lookbook/" 2>/dev/null || true
echo "$dir"
