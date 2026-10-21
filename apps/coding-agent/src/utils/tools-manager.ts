import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import nodeFs from "../core/platform/node/fs.ts";
import nodeOs from "../core/platform/node/os.ts";
import type toolsManagerTypes from "./tools-manager.types.ts";
import archiveExtract from "./tools-manager/archive-extract.ts";
import latestVersion from "./tools-manager/latest-version.ts";
import releaseDownload from "./tools-manager/release-download.ts";
import toolCatalog from "./tools-manager/tool-catalog.ts";

const { platform } = nodeOs;

const { awaited, awaiting } = awaitingModule;
const { rmSync, mkdirSync } = nodeFs;
const { TERMUX_PACKAGES, isOfflineModeEnabled, getToolPath, TOOLS } = toolCatalog;
const { extractBinary } = archiveExtract;
const { downloadReleaseArchive } = releaseDownload;
const { getLatestVersion } = latestVersion;

function downloadTool(tool: "fd" | "rg"): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const config = TOOLS[tool];
      if (config === undefined) throw new Error(`Unknown tool: ${tool}`);

      const plat = platform();
      const { extractDir, assetName, archivePath, binaryExt, binaryPath } =
        yield* downloadReleaseArchive(tool, plat, config);
      mkdirSync(extractDir, { recursive: true });

      try {
        extractBinary({ archivePath, assetName, binaryExt, binaryPath, config, extractDir, plat });
      } finally {
        rmSync(archivePath, { force: true });
        rmSync(extractDir, { force: true, recursive: true });
      }

      return binaryPath;
    }),
  );
}

function describeFailure(error: unknown): string {
  const messages: string[] = [];
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 5;
    current = current.cause, depth++
  ) {
    if (!messages.includes(current.message)) messages.push(current.message);
  }
  return messages.length > 0 ? messages.join(": ") : String(error);
}

function ensureToolImpl(
  tool: "fd" | "rg",
  onStatus?: (status: toolsManagerTypes.ToolStatus) => void,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const existingPath = getToolPath(tool);
      if (existingPath !== null && existingPath !== "") {
        return existingPath;
      }

      const config = TOOLS[tool];
      if (config === undefined) return undefined;

      if (isOfflineModeEnabled()) {
        onStatus?.({
          message: `${config.name} not found. Offline mode enabled, skipping download.`,
          type: "warning",
        });
        return undefined;
      }

      if (platform() === "android") {
        const pkgName = TERMUX_PACKAGES[tool] ?? tool;
        onStatus?.({
          message: `${config.name} not found. Install with: pkg install ${pkgName}`,
          type: "warning",
        });
        return undefined;
      }

      onStatus?.({ message: `${config.name} not found. Downloading...`, type: "info" });

      try {
        const path = yield* awaited(downloadTool(tool));
        onStatus?.({ message: `${config.name} installed to ${path}`, type: "info" });
        return path;
      } catch (e) {
        onStatus?.({
          message: `Failed to download ${config.name}: ${describeFailure(e)}`,
          type: "warning",
        });
        return undefined;
      }
    }),
  );
}

const ensureTool: {
  (
    tool: "fd" | "rg",
    onStatus?: (status: toolsManagerTypes.ToolStatus) => void,
  ): Promise<string | undefined>;
  (
    onStatus?: (status: toolsManagerTypes.ToolStatus) => void,
  ): (tool: "fd" | "rg") => Promise<string | undefined>;
} = dual((args: IArguments) => args.length >= 1, ensureToolImpl);

const toolsManager = {
  ensureTool,
  getLatestVersion,
  getToolPath,
};

export default toolsManager;
