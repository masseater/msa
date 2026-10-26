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

type TuiState = "children" | "fullRedraws" | "mode" | "onDebug" | "terminal";

const forwardedTuiMethods = (getTui: () => tuiTypes.TUI): Omit<tuiTypes.TUI, TuiState> => ({
  addChild: (component) => getTui().addChild(component),
  addInputListener: (listener) => getTui().addInputListener(listener),
  clear: () => getTui().clear(),
  getClearOnShrink: () => getTui().getClearOnShrink(),
  getShowHardwareCursor: () => getTui().getShowHardwareCursor(),
  handleMouse: (event) => getTui().handleMouse?.(event),
  hasOverlay: () => getTui().hasOverlay(),
  hideOverlay: () => getTui().hideOverlay(),
  invalidate: () => getTui().invalidate(),
  onTerminalColorSchemeChange: (listener) => getTui().onTerminalColorSchemeChange(listener),
  queryTerminalColors: (options) => getTui().queryTerminalColors(options),
  removeChild: (component) => getTui().removeChild(component),
  removeInputListener: (listener) => getTui().removeInputListener(listener),
  render: (width) => getTui().render(width),
  renderNow: (force) => getTui().renderNow(force),
  requestRender: (force) => getTui().requestRender(force),
  setClearOnShrink: (enabled) => getTui().setClearOnShrink(enabled),
  setFocus: (component) => getTui().setFocus(component),
  setShowHardwareCursor: (enabled) => getTui().setShowHardwareCursor(enabled),
  setTerminalColorSchemeNotifications: (enabled) =>
    getTui().setTerminalColorSchemeNotifications(enabled),
  showOverlay: (component, options) => getTui().showOverlay(component, options),
  start: () => getTui().start(),
  stop: (options) => getTui().stop(options),
});

function createInteractiveTuiReference(getTui: () => tuiTypes.TUI): tuiTypes.TUI {
  return {
    ...forwardedTuiMethods(getTui),
    get children() {
      return getTui().children;
    },
    set children(children) {
      getTui().children = children;
    },
    get fullRedraws() {
      return getTui().fullRedraws;
    },
    get mode() {
      return getTui().mode;
    },
    get onDebug() {
      return () => getTui().onDebug?.();
    },
    set onDebug(onDebug: () => void) {
      getTui().onDebug = onDebug;
    },
    get terminal() {
      return getTui().terminal;
    },
    set terminal(terminal) {
      getTui().terminal = terminal;
    },
  };
}

const tuiRenderer = {
  createInteractiveTui,
  createInteractiveTuiReference,
};

export default tuiRenderer;
