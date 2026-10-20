import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import bugReportModule from "../../core/bug-report.ts";
import type bugReportTypesModule from "../../core/bug-report.types.ts";
import pathModule from "../path.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart2 from "./bug-report-part2.ts";
import bugReportPart3 from "./bug-report-part3.ts";

const { awaited, awaiting } = awaitingModule;
const { join } = pathModule;
const { bugReportArchiveFileName, writeBugReportArchive } = bugReportModule;
const { errorMessage } = bugReportPart2;
const { recordInSession } = bugReportPart3;

function exportZip(
  context: bugReportInternalTypes.BugReportContext,
  bundle: bugReportTypesModule.BugReportBundle,
): Effect.Effect<void> {
  return awaiting(function* () {
    const archivePath = join(process.cwd(), bugReportArchiveFileName(bundle.metadata.id));
    try {
      yield* awaited(writeBugReportArchive(bundle, archivePath));
    } catch (error: unknown) {
      context.showError(`Failed to write bug report: ${errorMessage(error)}`);
      return;
    }
    recordInSession(context.session, bundle, { delivery: "zip", path: archivePath });
    context.showStatus(`Bug report exported to: ${archivePath}\nReport ID: ${bundle.metadata.id}`);
  });
}

const bugReportPart4 = {
  exportZip,
};

export default bugReportPart4;
