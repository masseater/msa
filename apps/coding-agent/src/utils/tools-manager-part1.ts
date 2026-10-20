import { platform } from "os";

import configModule from "../config.ts";
import platformNode from "../core/platform-node.ts";
import platformModule from "../core/platform.ts";
import nodeChildProcess from "../core/platform/node/child-process.ts";
import nodeFs from "../core/platform/node/fs.ts";
import type toolsManagerInternalTypes from "./tools-manager-internal.types.ts";

const { getBinDir } = configModule;
const { readEnv } = platformModule;
const { spawnSync } = nodeChildProcess;
const { join } = platformNode;
const { existsSync } = nodeFs;

const TOOLS_DIR = getBinDir();

const NETWORK_TIMEOUT_MS = 10_000;

const DOWNLOAD_TIMEOUT_MS = 120_000;

function isOfflineModeEnabled(): boolean {
  const value = readEnv("MSA_OFFLINE");
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

const TOOLS: Record<string, toolsManagerInternalTypes.ToolConfig> = {
  fd: {
    binaryName: "fd",
    getAssetName: (version, plat, architecture) => {
      if (plat === "darwin") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
      } else if (plat === "linux") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-unknown-linux-musl.tar.gz`;
      } else if (plat === "win32") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
    name: "fd",
    repo: "sharkdp/fd",
    systemBinaryNames: ["fd", "fdfind"],
    tagPrefix: "v",
  },
  rg: {
    binaryName: "rg",
    getAssetName: (version, plat, architecture) => {
      if (plat === "darwin") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
      } else if (plat === "linux") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `ripgrep-${version}-${archStr}-unknown-linux-musl.tar.gz`;
      } else if (plat === "win32") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
    name: "ripgrep",
    repo: "BurntSushi/ripgrep",
    tagPrefix: "",
  },
};

function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });

    return result.error === undefined || result.error === null;
  } catch {
    return false;
  }
}

function getToolPath(tool: "fd" | "rg"): string | null {
  const config = TOOLS[tool];
  if (config === undefined) return null;

  const localPath = join(TOOLS_DIR, config.binaryName + (platform() === "win32" ? ".exe" : ""));
  if (existsSync(localPath)) {
    return localPath;
  }

  const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
  for (const systemBinaryName of systemBinaryNames) {
    if (commandExists(systemBinaryName)) {
      return systemBinaryName;
    }
  }

  return null;
}

const toolsManagerPart1 = {
  DOWNLOAD_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  TOOLS,
  TOOLS_DIR,
  getToolPath,
  isOfflineModeEnabled,
};

export default toolsManagerPart1;
