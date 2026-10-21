import type TerminalStatusReporterClass from "./terminal-status.ts";

declare namespace terminalStatusTypes {
  type TerminalStatusReporter = TerminalStatusReporterClass;
}

export type { terminalStatusTypes as default };
