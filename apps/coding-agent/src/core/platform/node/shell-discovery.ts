import { existsSync } from "node:fs";

import type shellTypes from "../../../utils/shell.types.ts";
import platformEnv from "../env.ts";
import nodeChildProcess from "./child-process.ts";

const { spawnSync } = nodeChildProcess;
const { readEnv } = platformEnv;

function isLegacyWslBashPath(path: string): boolean {
  const normalized = path.replace(/\//gu, "\\").toLowerCase();
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/u.test(normalized);
}

function getBashShellConfig(shell: string): shellTypes.ShellConfig {
  return isLegacyWslBashPath(shell)
    ? { args: ["-s"], commandTransport: "stdin", shell }
    : { args: ["-c"], shell };
}

function findExecutableOnPath(executable: string): string | null {
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

function getShellConfig(customShellPath?: string): shellTypes.ShellConfig {
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

  return { args: ["-c"], shell: "sh" };
}

const shellDiscovery = { findExecutableOnPath, getShellConfig };

export default shellDiscovery;
