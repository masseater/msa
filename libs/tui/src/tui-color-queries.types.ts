import type terminalColorsTypes from "./terminal-colors.types.ts";
import type TerminalColorQueriesClass from "./tui-color-queries.ts";

declare namespace tuiColorQueriesTypes {
  interface TerminalColorQueryOptions {
    timeoutMs: number;
    onLateReply?: (colors: terminalColorsTypes.TerminalColors) => void;
  }

  type TerminalColorQueries = TerminalColorQueriesClass;
}

export type { tuiColorQueriesTypes as default };
