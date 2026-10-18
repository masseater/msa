import { readFileSync } from "node:fs";

import { envSnapshot } from "../core/process-env.ts";

/** Windows Subsystem for Linux, where Windows executables are reachable through interop. */
export function isWSL(env: NodeJS.ProcessEnv = envSnapshot()): boolean {
  if (env["WSL_DISTRO_NAME"] || env["WSLENV"]) {
    return true;
  }

  try {
    const release = readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}
