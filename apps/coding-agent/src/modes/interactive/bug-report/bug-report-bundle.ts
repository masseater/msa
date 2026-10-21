import { Effect } from "effect";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import awaitingModule from "../../../core/awaiting.ts";
import bugReportModule from "../../../core/bug-report.ts";
import type bugReportTypesModule from "../../../core/bug-report.types.ts";
import crashLog from "../../../core/crash-log.ts";
import platform from "../../../core/platform/index.ts";
import sessionExport from "../../../core/session-export.ts";
import type bugReportInternalTypes from "../bug-report-internal.types.ts";
import shareTrailingEntries from "../share-trailing-entries.ts";

const {
  writeBugReportArchive,
  bugReportArchiveFileName,
  BUG_REPORT_CUSTOM_ENTRY_TYPE,
  collectBugReportMetadata,
  collectBugReportDiagnostics,
} = bugReportModule;
const { awaited, awaiting } = awaitingModule;
const { join } = platform;
const { clearCrashLog, readCrashLog } = crashLog;
const { createShareTrailingEntries } = shareTrailingEntries;
const { serializeSessionBranch } = sessionExport;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildBundle(
  session: agentSessionTypes.AgentSession,
  options: bugReportInternalTypes.BugReportOptions,
  summary: string | undefined,
): Promise<bugReportTypesModule.BugReportBundle> {
  return readCrashLog().then((crashes) => bundleWith({ crashes, options, session, summary }));
}

function bundleWith(parts: {
  readonly session: agentSessionTypes.AgentSession;
  readonly options: bugReportInternalTypes.BugReportOptions;
  readonly summary: string | undefined;
  readonly crashes: Awaited<ReturnType<typeof readCrashLog>>;
}): bugReportTypesModule.BugReportBundle {
  const { crashes, options, session, summary } = parts;
  const extensions = session.resourceLoader.getExtensions();
  return {
    diagnostics: collectBugReportDiagnostics(session.sessionManager, crashes),
    metadata: collectBugReportMetadata({
      cwd: session.sessionManager.getCwd(),
      extensionErrors: extensions.errors,
      extensions: extensions.extensions,
      globalSettings: session.settingsManager.getGlobalSettings(),
      hint: options.hint,
      includeSession: options.includeSession,
      includeSummary: summary !== undefined,
      messageCount: session.messages.length,
      model: session.model,
      modelRuntime: session.models.selection.modelRuntime,
      projectSettings: session.settingsManager.getProjectSettings(),
      sessionId: session.sessionId,
      thinkingLevel: session.thinkingLevel,
    }),
    sessionJsonl: options.includeSession
      ? serializeSessionBranch(session.sessionManager, (parentId, timestamp) =>
          createShareTrailingEntries(session, parentId, timestamp),
        )
      : undefined,
    summary,
  };
}

function recordInSession(
  session: agentSessionTypes.AgentSession,
  bundle: bugReportTypesModule.BugReportBundle,
  delivery: Pick<bugReportTypesModule.BugReportSessionEntryData, "delivery" | "path">,
): Promise<void> {
  session.sessionManager.appendCustomEntry(BUG_REPORT_CUSTOM_ENTRY_TYPE, {
    createdAt: bundle.metadata.createdAt,
    hint: bundle.metadata.hint,
    id: bundle.metadata.id,
    sessionIncluded: bundle.metadata.session.included,
    summaryIncluded: bundle.metadata.session.summaryIncluded,
    ...delivery,
  } satisfies bugReportTypesModule.BugReportSessionEntryData);
  return bundle.diagnostics.crashes.length > 0 ? clearCrashLog() : Promise.resolve();
}

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
    yield* awaited(
      recordInSession(context.session, bundle, { delivery: "zip", path: archivePath }),
    );
    context.showStatus(`Bug report exported to: ${archivePath}\nReport ID: ${bundle.metadata.id}`);
  });
}

const bugReportBundle = { buildBundle, errorMessage, exportZip };

export default bugReportBundle;
