import config from "../config.ts";
import platformModule from "../core/platform/index.ts";
import nodeChildProcess from "../core/platform/node/child-process.ts";
import shellDiscovery from "../core/platform/node/shell-discovery.ts";
import type shellTypes from "./shell.types.ts";

const { spawn } = nodeChildProcess;
const { findExecutableOnPath, getShellConfig } = shellDiscovery;

const { delimiter, join, readEnv } = platformModule;
const { getBinDir } = config;

const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
] as const;

function getPowerShellConfig(): shellTypes.ShellConfig {
  if (process.platform !== "win32") {
    throw new Error("The powershell tool is only available on Windows.");
  }

  const shell = findExecutableOnPath("pwsh.exe") ?? findExecutableOnPath("powershell.exe");
  if (shell === null || shell === "") {
    throw new Error(
      "No PowerShell executable found. Install PowerShell or add powershell.exe/pwsh.exe to PATH.",
    );
  }

  return { args: [...POWERSHELL_ARGS], shell };
}

function getShellEnv(): NodeJS.ProcessEnv {
  const binDir = getBinDir();
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = readEnv(pathKey) ?? "";
  const pathEntries = currentPath.split(delimiter).filter(Boolean);
  const hasBinDir = pathEntries.includes(binDir);
  const updatedPath = hasBinDir
    ? currentPath
    : [binDir, currentPath].filter(Boolean).join(delimiter);

  return {
    ...process.env,
    [pathKey]: updatedPath,
  };
}

function sanitizeBinaryOutput(str: string): string {
  return Array.from(str)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !(
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        (code >= 0xfff9 && code <= 0xfffb)
      );
    })
    .join("");
}

const trackedDetachedChildPids = new Set<number>();

function trackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.add(pid);
}

function untrackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.delete(pid);
}

function killTrackedDetachedChildren(): void {
  for (const pid of trackedDetachedChildPids) {
    killProcessTree(pid);
  }
  trackedDetachedChildPids.clear();
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      const child = spawn(
        join(readEnv("SystemRoot") ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/F", "/T", "/PID", String(pid)],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );

      child.once("error", () => {});
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

const shell = {
  POWERSHELL_ARGS,
  findExecutableOnPath,
  getPowerShellConfig,
  getShellConfig,
  getShellEnv,
  killProcessTree,
  killTrackedDetachedChildren,
  sanitizeBinaryOutput,
  trackDetachedChildPid,
  untrackDetachedChildPid,
};

export default shell;
