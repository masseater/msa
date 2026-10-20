import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import McpManagerView from "../src/extensions/mcp/mcp-manager-view.ts";
import type uiTypes from "../src/extensions/mcp/ui.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
const { stripAnsi } = ansi;
const { initTheme, theme } = themeModule;
const { setKeybindings } = tuiModule;

const ESCAPE = "\x1b";
const tui = { requestRender: vi.fn() } as unknown as tuiTypes.TUI;

function rendered(view: uiTypes.McpManagerView): string {
  return stripAnsi(view.render(80).join("\n"));
}

const cancelsTheRunningOperationWithTheCancel = () => {
  const view = new McpManagerView(tui, theme, new KeybindingsManager());
  const onCancel = vi.fn();
  view.status("Sign in to issues", "Contacting the authorization server…", onCancel);
  expect(rendered(view)).toContain("cancel");
  view.handleInput(ESCAPE);
  expect(onCancel).toHaveBeenCalledOnce();
};

const ignoresTheCancelKeyForOperationsThat = () => {
  const view = new McpManagerView(tui, theme, new KeybindingsManager());
  view.status("Sign in to issues", "Connecting…");
  expect(rendered(view)).not.toContain("cancel");
  view.handleInput(ESCAPE);
};

describe("MCP manager status screen", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  test(
    "cancels the running operation with the cancel key",
    cancelsTheRunningOperationWithTheCancel,
  );

  test(
    "ignores the cancel key for operations that cannot be cancelled",
    ignoresTheCancelKeyForOperationsThat,
  );
});
