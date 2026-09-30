#!/bin/bash
# Run a command in one of two shared "browser slots" (docs/GRAPHICS_HANDOFF.md: at most two headless-Chromium jobs at once on this
# 4-core software-GPU box). Several sessions or helpers share the slots through lock files, so a third job waits its turn instead
# of starving the other two. usage: scripts/withslot.sh node scripts/lookbook.mjs low   (SLOT_DIR overrides the lock folder)
SLOT_DIR="${SLOT_DIR:-/home/user/slopmerica/shots/tmp/slots}"
mkdir -p "$SLOT_DIR"
while true; do
  for n in 1 2; do
    exec {fd}>"$SLOT_DIR/slot-$n.lock"
    if flock -n "$fd"; then "$@"; code=$?; exec {fd}>&-; exit $code; fi
    exec {fd}>&-
  done
  sleep 4
done
