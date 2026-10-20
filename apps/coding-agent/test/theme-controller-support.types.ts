import type { TerminalColors } from "@msa/tui";

declare namespace themeControllerSupportTypes {
  type ColorQueryOptions = { timeoutMs: number; onLateReply?: (colors: TerminalColors) => void };
}

export type { themeControllerSupportTypes as default };
