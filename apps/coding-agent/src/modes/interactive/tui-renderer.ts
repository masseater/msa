import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import clipboard from "../../utils/clipboard.ts";
import errors from "../../utils/errors.ts";
import openBrowserModule from "../../utils/open-browser.ts";
import keybindingHints from "./components/keybinding-hints.ts";
import themeModule from "./theme/theme.ts";
import type tuiRendererTypes from "./tui-renderer.types.ts";

const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;
const { openBrowser } = openBrowserModule;
const { awaited, awaiting } = awaitingModule;
const { copyToClipboard } = clipboard;
const { toErrorMessage } = errors;

const { ProcessTerminal, TuiAltScreen, TuiMainScreen } = tuiModule;

function createInteractiveTui(
  options: tuiRendererTypes.InteractiveTuiOptions & { readonly tuiMode: "fullscreen" },
): tuiTypes.TuiAltScreen;
function createInteractiveTui(
  options: tuiRendererTypes.InteractiveTuiOptions & { readonly tuiMode: "regular" },
): tuiTypes.TuiMainScreen;
function createInteractiveTui(
  options: tuiRendererTypes.InteractiveTuiOptions,
): tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen;
function createInteractiveTui(
  options: tuiRendererTypes.InteractiveTuiOptions,
): tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen {
  const terminal = options.terminal ?? new ProcessTerminal();
  if (options.tuiMode === "fullscreen") {
    const styleSearchMatch = (text: string) =>
      theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
    return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
      openUrl: openBrowser,
      scrollToEndIndicator: () => {
        const shortcut = keyDisplayText("tui.altScreen.bottom");
        const label = ` ↓ Jump to latest message${shortcut === "" ? "" : ` · ${shortcut}`} `;
        return theme.bg("selectedBg", theme.fg("text", label));
      },
      searchCurrentMatchStyle: (text) => theme.bold(theme.inverse(styleSearchMatch(text))),
      searchMatchStyle: (text) => theme.underline(styleSearchMatch(text)),
      searchNavigationButtonStyle: (text, hovered) => (hovered ? theme.underline(text) : text),
      ...(options.onRightClickPaste === undefined
        ? {}
        : { onRightClickPaste: options.onRightClickPaste }),
      ...(options.fullscreenCopyOnSelect === undefined
        ? {}
        : { copyOnSelect: options.fullscreenCopyOnSelect }),
      copySelection: (text) =>
        Effect.runPromise(
          awaiting(function* () {
            try {
              yield* awaited(copyToClipboard(text));
              return true;
            } catch (error) {
              return toErrorMessage(error);
            }
          }),
        ),
      wheelScrollLines: options.fullscreenWheelScrollLines ?? "auto",
    });
  }
  return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}

function createInteractiveTuiReference(getTui: () => tuiTypes.TUI): tuiTypes.TUI {
  return new Proxy({} as tuiTypes.TUI, {
    get: (_target, property) => {
      const tui = getTui();
      const value = Reflect.get(tui, property, tui);
      if (typeof value !== "function") return value;
      let methodTui = tui;
      let method = value;
      return (...args: unknown[]) => {
        const currentTui = getTui();
        if (currentTui !== methodTui) {
          const currentMethod = Reflect.get(currentTui, property, currentTui);
          if (typeof currentMethod !== "function") {
            throw new TypeError(`TUI property ${String(property)} is not callable`);
          }
          methodTui = currentTui;
          method = currentMethod;
        }
        return Reflect.apply(method, methodTui, args);
      };
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
    has: (_target, property) => Reflect.has(getTui(), property),
    set: (_target, property, value) => {
      const tui = getTui();
      return Reflect.set(tui, property, value, tui);
    },
  });
}

const tuiRenderer = {
  createInteractiveTui,
  createInteractiveTuiReference,
};

export default tuiRenderer;
