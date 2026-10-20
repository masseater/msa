import { execFile, execSync, spawn, spawnSync } from "node:child_process";

const nodeChildProcess = {
  execFile,
  execSync,
  spawn,
  spawnSync,
};

export default nodeChildProcess;
