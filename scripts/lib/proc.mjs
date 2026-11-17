// Starting and stopping child processes the same way on Windows, Linux and macOS.
import { spawn, spawnSync } from 'node:child_process';

/**
 * Start a command so that killTree() can later take it down with everything it started (a test's browser, a server's workers).
 * `node` is always this Node, whatever is on the PATH.
 */
export function start(cmd, args = [], opts = {}) {
  const exe = cmd === 'node' ? process.execPath : cmd;
  return spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts, detached: process.platform !== 'win32', windowsHide: true });
}

/** Kill a process and all its descendants. On Windows that is taskkill /T; elsewhere the process group that start() made. */
export function killTree(child) {
  const pid = typeof child === 'number' ? child : child?.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
}
