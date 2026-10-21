import { describe, expect, test, vi } from "vite-plus/test";

import triggerCompactExtension from "../examples/extensions/trigger-compact.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";

function createContext(tokens: number | null, compact = vi.fn()): extensionsTypes.ExtensionContext {
  return {
    abort: vi.fn(),
    compact,
    cwd: process.cwd(),
    getContextUsage: () => ({
      contextWindow: 200_000,
      percent: tokens === null ? null : tokens / 2000,
      tokens,
    }),
    getSystemPrompt: () => "",
    hasPendingMessages: () => false,
    hasUI: false,
    isIdle: () => true,
    isProjectTrusted: () => true,
    mode: "print",
    model: undefined,
    modelRegistry: {} as extensionsTypes.ExtensionContext["modelRegistry"],
    scopedModels: [],
    sessionManager: {} as extensionsTypes.ExtensionContext["sessionManager"],
    shutdown: vi.fn(),
    signal: undefined,
    ui: {} as extensionsTypes.ExtensionContext["ui"],
  };
}

const onlyAutoCompactsWhenContextUsageCrosses = () => {
  let turnEndHandler:
    | ((
        event: { type: "turn_end" },
        ctx: extensionsTypes.ExtensionContext | extensionsTypes.ExtensionCommandContext,
      ) => void)
    | undefined;

  const api = {
    on: (
      event: string,
      handler: (event: { type: "turn_end" }, ctx: extensionsTypes.ExtensionContext) => void,
    ) => {
      if (event === "turn_end") {
        turnEndHandler = handler;
      }
    },
    registerCommand: vi.fn(),
  } as unknown as extensionsTypes.ExtensionAPI;

  triggerCompactExtension(api);
  expect(turnEndHandler).toBeDefined();

  const compact = vi.fn();
  const event = { type: "turn_end" } as const;

  turnEndHandler?.(event, createContext(110_000, compact));
  expect(compact).not.toHaveBeenCalled();

  turnEndHandler?.(event, createContext(120_000, compact));
  expect(compact).not.toHaveBeenCalled();

  turnEndHandler?.(event, createContext(95_000, compact));
  expect(compact).not.toHaveBeenCalled();

  turnEndHandler?.(event, createContext(105_000, compact));
  expect(compact).toHaveBeenCalledTimes(1);
};

describe("trigger-compact example extension", () => {
  test(
    "only auto-compacts when context usage crosses the threshold",
    onlyAutoCompactsWhenContextUsageCrosses,
  );
});
