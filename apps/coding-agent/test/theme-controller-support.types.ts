import type tuiTypes from "@msa/tui/index.types";

declare namespace themeControllerSupportTypes {
  type ColorQueryOptions = {
    timeoutMs: number;
    onLateReply?: (colors: tuiTypes.TerminalColors) => void;
  };
}

export type { themeControllerSupportTypes as default };
