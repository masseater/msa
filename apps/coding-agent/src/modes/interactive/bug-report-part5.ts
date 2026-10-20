import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type bugReportTypesModule from "../../core/bug-report.types.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart1 from "./bug-report-part1.ts";
import bugReportPart2 from "./bug-report-part2.ts";
import bugReportPart3 from "./bug-report-part3.ts";
import bugReportPart4 from "./bug-report-part4.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { promptForOptions, restoreEditor } = bugReportPart1;
const { errorMessage, showLoader } = bugReportPart2;
const { buildBundle } = bugReportPart3;
const { exportZip } = bugReportPart4;

const reportBug: {
  (initialHint?: string): (context: bugReportInternalTypes.BugReportContext) => Promise<void>;
  (context: bugReportInternalTypes.BugReportContext, initialHint?: string): Promise<void>;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  (context: bugReportInternalTypes.BugReportContext, initialHint?: string): Promise<void> =>
    Effect.runPromise(
      awaiting(function* () {
        const options = yield* performed(promptForOptions(context, initialHint));
        if (options === undefined) {
          context.showStatus("Bug report cancelled");
          return;
        }

        let summary: string | undefined;
        if (options.includeSummary) {
          const loader = showLoader(
            context,
            `Writing summary with ${context.session.model?.name ?? "the current model"}...`,
          );
          try {
            summary = yield* awaited(
              context.session.context.exports.summarizeForBugReport({
                hint: options.hint,
                signal: loader.signal,
              }),
            );
          } catch (error: unknown) {
            restoreEditor(context, loader);
            if (loader.signal.aborted) context.showStatus("Bug report cancelled");
            else context.showError(`Failed to write bug report summary: ${errorMessage(error)}`);
            return;
          }
          restoreEditor(context, loader);
          if (loader.signal.aborted) {
            context.showStatus("Bug report cancelled");
            return;
          }
        }

        let bundle: bugReportTypesModule.BugReportBundle;
        try {
          bundle = buildBundle(context.session, options, summary);
        } catch (error: unknown) {
          context.showError(`Failed to build bug report: ${errorMessage(error)}`);
          return;
        }

        yield* performed(exportZip(context, bundle));
      }),
    ),
);

const bugReportPart5 = {
  reportBug,
};

export default bugReportPart5;
