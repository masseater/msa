import { readFileSync } from "node:fs";

export function isWSL(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    (env["WSL_DISTRO_NAME"] !== undefined && env["WSL_DISTRO_NAME"] !== "") ||
    (env["WSLENV"] !== undefined && env["WSLENV"] !== "")
  ) {
    return true;
  }

  try {
    const release = readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/iu.test(release);
  } catch {
    return false;
  }
}
