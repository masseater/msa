import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";
const TERMINAL_QUERY_TIMEOUT_MS = 100;
const requestTerminalColors: {
  (apply: (colors: tuiTypes.TerminalColors) => void): (ui: tuiTypes.TUI) => Promise<void>;
  (ui: tuiTypes.TUI, apply: (colors: tuiTypes.TerminalColors) => void): Promise<void>;
} = dual(2, (ui: tuiTypes.TUI, apply: (colors: tuiTypes.TerminalColors) => void): Promise<void> => {
  let query: Promise<tuiTypes.TerminalColors>;
  try {
    query = ui.queryTerminalColors({ onLateReply: apply, timeoutMs: TERMINAL_QUERY_TIMEOUT_MS });
  } catch {
    query = Promise.resolve({});
  }
  return query.then(apply, () => apply({}));
});

const themeController = {
  requestTerminalColors,
};

export default themeController;
