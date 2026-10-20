import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import { copyToClipboard } from "../../utils/clipboard.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { keyDisplayText } from "./components/keybinding-hints.ts";
import { theme } from "./theme/theme.ts";

const { ProcessTerminal, TuiAltScreen, TuiMainScreen } = tuiModule;

export interface InteractiveTuiOptions {
  readonly tuiMode: "regular" | "fullscreen";
  readonly showHardwareCursor: boolean;
  readonly logDirectory: string;
  readonly terminal?: tuiTypes.Terminal | undefined;
  readonly onRightClickPaste?: (() => void) | undefined;
  readonly fullscreenCopyOnSelect?: boolean | undefined;
  readonly fullscreenWheelScrollLines?: tuiTypes.WheelScrollLines | undefined;
}

export function createInteractiveTui(
  options: InteractiveTuiOptions & { readonly tuiMode: "fullscreen" },
): tuiTypes.TuiAltScreen;
export function createInteractiveTui(
  options: InteractiveTuiOptions & { readonly tuiMode: "regular" },
): tuiTypes.TuiMainScreen;
export function createInteractiveTui(
  options: InteractiveTuiOptions,
): tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen;
export function createInteractiveTui(
  options: InteractiveTuiOptions,
): tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen {
  const terminal = options.terminal ?? new ProcessTerminal();
  if (options.tuiMode === "fullscreen") {
    const styleSearchMatch = (text: string) =>
      theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
    return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
      searchMatchStyle: (text) => theme.underline(styleSearchMatch(text)),
      searchCurrentMatchStyle: (text) => theme.bold(theme.inverse(styleSearchMatch(text))),
      searchNavigationButtonStyle: (text, hovered) => (hovered ? theme.underline(text) : text),
      scrollToEndIndicator: () => {
        const shortcut = keyDisplayText("tui.altScreen.bottom");
        const label = ` ↓ Jump to latest message${shortcut === "" ? "" : ` · ${shortcut}`} `;
        return theme.bg("selectedBg", theme.fg("text", label));
      },
      openUrl: openBrowser,
      ...(options.onRightClickPaste === undefined
        ? {}
        : { onRightClickPaste: options.onRightClickPaste }),
      ...(options.fullscreenCopyOnSelect === undefined
        ? {}
        : { copyOnSelect: options.fullscreenCopyOnSelect }),
      wheelScrollLines: options.fullscreenWheelScrollLines ?? "auto",
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
    });
  }
  return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}

export function createInteractiveTuiReference(getTui: () => tuiTypes.TUI): tuiTypes.TUI {
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
