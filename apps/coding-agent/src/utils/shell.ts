import { spawn, spawnSync } from "child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { getBinDir } from "../config.ts";
import { readEnv } from "../core/platform.ts";

export interface ShellConfig {
  shell: string;
  args: string[];
  commandTransport?: "argv" | "stdin";
}

function isLegacyWslBashPath(path: string): boolean {
  const normalized = path.replace(/\//gu, "\\").toLowerCase();
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/u.test(normalized);
}

function getBashShellConfig(shell: string): ShellConfig {
  return isLegacyWslBashPath(shell)
    ? { shell, args: ["-s"], commandTransport: "stdin" }
    : { shell, args: ["-c"] };
}

export function findExecutableOnPath(executable: string): string | null {
  if (process.platform === "win32") {
    try {
      const result = spawnSync("where", [executable], {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout !== "") {
        const firstMatch = result.stdout.trim().split(/\r?\n/u)[0];
        if (firstMatch !== undefined && firstMatch !== "" && existsSync(firstMatch)) {
          return firstMatch;
        }
      }
    } catch {}
    return null;
  }

  try {
    const result = spawnSync("which", [executable], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0 && result.stdout !== "") {
      const firstMatch = result.stdout.trim().split(/\r?\n/u)[0];
      if (firstMatch !== undefined && firstMatch !== "") {
        return firstMatch;
      }
    }
  } catch {}
  return null;
}

export function getShellConfig(customShellPath?: string): ShellConfig {
  if (customShellPath !== undefined && customShellPath !== "") {
    if (existsSync(customShellPath)) {
      return getBashShellConfig(customShellPath);
    }
    throw new Error(`Custom shell path not found: ${customShellPath}`);
  }

  if (process.platform === "win32") {
    const paths: string[] = [];
    const programFiles = readEnv("ProgramFiles");
    if (programFiles !== undefined && programFiles !== "") {
      paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
    }
    const programFilesX86 = readEnv("ProgramFiles(x86)");
    if (programFilesX86 !== undefined && programFilesX86 !== "") {
      paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
    }

    for (const path of paths) {
      if (existsSync(path)) {
        return getBashShellConfig(path);
      }
    }

    const bashOnPath = findExecutableOnPath("bash.exe");
    if (bashOnPath !== null && bashOnPath !== "") {
      return getBashShellConfig(bashOnPath);
    }

    throw new Error(
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
        "  3. Set shellPath in settings.json\n\n" +
        `Searched Git Bash in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
    );
  }

  if (existsSync("/bin/bash")) {
    return getBashShellConfig("/bin/bash");
  }

  const bashOnPath = findExecutableOnPath("bash");
  if (bashOnPath !== null && bashOnPath !== "") {
    return getBashShellConfig(bashOnPath);
  }

  return { shell: "sh", args: ["-c"] };
}

export const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
] as const;

export function getPowerShellConfig(): ShellConfig {
  if (process.platform !== "win32") {
    throw new Error("The powershell tool is only available on Windows.");
  }

  const shell = findExecutableOnPath("pwsh.exe") ?? findExecutableOnPath("powershell.exe");
  if (shell === null || shell === "") {
    throw new Error(
      "No PowerShell executable found. Install PowerShell or add powershell.exe/pwsh.exe to PATH.",
    );
  }

  return { shell, args: [...POWERSHELL_ARGS] };
}

export function getShellEnv(): NodeJS.ProcessEnv {
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

export function sanitizeBinaryOutput(str: string): string {
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

export function trackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.add(pid);
}

export function untrackDetachedChildPid(pid: number): void {
  trackedDetachedChildPids.delete(pid);
}

export function killTrackedDetachedChildren(): void {
  for (const pid of trackedDetachedChildPids) {
    killProcessTree(pid);
  }
  trackedDetachedChildPids.clear();
}

export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      const child = spawn(
        join(readEnv("SystemRoot") ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/F", "/T", "/PID", String(pid)],
        {
          stdio: "ignore",
          detached: true,
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
