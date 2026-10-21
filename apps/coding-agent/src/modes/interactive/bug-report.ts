import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type bugReportTypesModule from "../../core/bug-report.types.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportBundle from "./bug-report/bug-report-bundle.ts";
import bugReportPrompts from "./bug-report/bug-report-prompts.ts";

const { awaited, performed, awaiting } = awaitingModule;
const { exportZip, buildBundle, errorMessage } = bugReportBundle;
const { restoreEditor, showLoader, promptForOptions } = bugReportPrompts;

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

const bugReport = { reportBug };

export default bugReport;
