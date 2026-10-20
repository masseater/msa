import { platform } from "os";

import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import toolsManagerPart1 from "./tools-manager-part1.ts";
import toolsManagerPart5 from "./tools-manager-part5.ts";
import type toolsManagerTypes from "./tools-manager.types.ts";

const { awaited, awaiting } = awaitingModule;
const { TOOLS, getToolPath, isOfflineModeEnabled } = toolsManagerPart1;
const { TERMUX_PACKAGES, downloadTool } = toolsManagerPart5;

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
        const messages: string[] = [];
        for (
          let current: unknown = e, depth = 0;
          current instanceof Error && depth < 5;
          current = current.cause, depth++
        ) {
          if (!messages.includes(current.message)) messages.push(current.message);
        }
        onStatus?.({
          message: `Failed to download ${config.name}: ${messages.length > 0 ? messages.join(": ") : String(e)}`,
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

const toolsManagerPart6 = {
  ensureTool,
};

export default toolsManagerPart6;
