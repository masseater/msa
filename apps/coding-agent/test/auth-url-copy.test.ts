import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import McpManagerView from "../src/extensions/mcp/mcp-manager-view.ts";
import LoginDialogComponent from "../src/modes/interactive/components/login-dialog.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { stripAnsi } = ansi;
const { initTheme, theme } = themeModule;
const { setKeybindings } = tuiModule;

const { abortController, awaited, runTest } = testing;

const { copyToClipboard } = vi.hoisted(() => ({
  copyToClipboard: vi.fn((_text: string) => testing.runTest(Effect.sync(() => {}))),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: { copyToClipboard } }));
vi.mock("../src/utils/open-browser.ts", () => ({ default: { openBrowser: vi.fn() } }));

const URL = `https://auth.example.invalid/authorize?${"x".repeat(300)}`;
const CTRL_X = "\x18";

const tui = { requestRender: vi.fn() } as unknown as tuiTypes.TUI;

function rendered(component: { render(width: number): string[] }): string {
  return stripAnsi(component.render(80).join("\n"));
}

const loginDialogCopiesTheAuthUrlInstead = () =>
  runTest(
    Effect.gen(function* () {
      const dialog = new LoginDialogComponent(tui, "test", () => {});
      dialog.showAuth(URL);
      void dialog.showManualInput("Paste the code:");
      expect(rendered(dialog)).toContain("ctrl+x to copy");

      dialog.handleInput(CTRL_X);
      yield* awaited(
        vi.waitFor(() => expect(rendered(dialog)).toContain("Copied URL to clipboard")),
      );
      expect(copyToClipboard).toHaveBeenCalledWith(URL);
    }),
  );

const loginDialogIgnoresTheCopyKeyWithout = () => {
  const dialog = new LoginDialogComponent(tui, "test", () => {});
  dialog.showDeviceCode({ userCode: "ABCD", verificationUri: "https://example.invalid/device" });
  dialog.handleInput(CTRL_X);
  expect(copyToClipboard).not.toHaveBeenCalled();
};

const mcpSignInScreenCopiesTheAuthorization = () =>
  runTest(
    Effect.gen(function* () {
      const view = new McpManagerView(tui, theme, new KeybindingsManager());
      void view.redirectUrl("Sign in to issues", URL, abortController().signal);
      expect(rendered(view)).toContain("ctrl+x to copy");

      view.handleInput(CTRL_X);
      yield* awaited(vi.waitFor(() => expect(rendered(view)).toContain("Copied URL to clipboard")));
      expect(copyToClipboard).toHaveBeenCalledWith(URL);
    }),
  );

describe("sign-in URL copy key", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
    copyToClipboard.mockClear();
  });

  test(
    "login dialog copies the auth URL instead of typing into the code input",
    loginDialogCopiesTheAuthUrlInstead,
  );

  test(
    "login dialog ignores the copy key without an auth URL",
    loginDialogIgnoresTheCopyKeyWithout,
  );

  test("MCP sign-in screen copies the authorization URL", mcpSignInScreenCopiesTheAuthorization);
});
