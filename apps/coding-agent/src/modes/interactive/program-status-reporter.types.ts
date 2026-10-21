import type tuiTypes from "@msa/tui/index.types";

import type ProgramStatusReporterClass from "./program-status-reporter.ts";

declare namespace programStatusReporterTypes {
  type BlockedStatus = { kind: NonNullable<tuiTypes.ProgramStatus["kind"]>; message: string };

  type ProgramStatusReporter = (typeof ProgramStatusReporterClass)["prototype"];
}

export type { programStatusReporterTypes as default };
