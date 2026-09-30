#!/bin/bash
# Run a command in one of two shared "browser slots" (docs/GRAPHICS_HANDOFF.md: at most two headless-Chromium jobs at once on this
# 4-core software-GPU box). Several sessions or helpers share the slots through lock files, so a third job waits its turn instead
# of starving the other two. Waiters queue first-come-first-served: they line up on queue.lock (a blocking flock), and only the
# one at the head polls the two slots, once a second, so a job that ends and immediately asks again goes to the back of the line.
# Keep each job short (one capture run, not a whole batch): the slot is held until the command exits.
# usage: scripts/withslot.sh node scripts/lookbook.mjs low   (SLOT_DIR overrides the lock folder)
SLOT_DIR="${SLOT_DIR:-/home/user/slopmerica/shots/tmp/slots}"
mkdir -p "$SLOT_DIR"
exec {q}>"$SLOT_DIR/queue.lock"
flock "$q"
while true; do
  for n in 1 2; do
    exec {fd}>"$SLOT_DIR/slot-$n.lock"
    if flock -n "$fd"; then exec {q}>&-; "$@"; code=$?; exec {fd}>&-; exit $code; fi
    exec {fd}>&-
  done
  sleep 1
done
