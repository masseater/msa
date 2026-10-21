import { platform } from "os";

import configModule from "../../config.ts";
import platformNode from "../../core/platform-node.ts";
import platformModule from "../../core/platform.ts";
import nodeChildProcess from "../../core/platform/node/child-process.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import type toolsManagerInternalTypes from "../tools-manager-internal.types.ts";

const { readEnv } = platformModule;
const { existsSync } = nodeFs;
const { join } = platformNode;
const { spawnSync } = nodeChildProcess;
const { getBinDir } = configModule;

const TOOLS_DIR = getBinDir();

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

const TERMUX_PACKAGES: Record<string, string> = {
  fd: "fd",
  rg: "ripgrep",
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

function isOfflineModeEnabled(): boolean {
  const value = readEnv("MSA_OFFLINE");
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

const toolCatalog = { TERMUX_PACKAGES, TOOLS, TOOLS_DIR, getToolPath, isOfflineModeEnabled };

export default toolCatalog;
