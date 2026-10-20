import type agentSessionTypes from "../../core/agent-session.types.ts";
import bugReportModule from "../../core/bug-report.ts";
import type bugReportTypesModule from "../../core/bug-report.types.ts";
import crashLog from "../../core/crash-log.ts";
import sessionExport from "../../core/session-export.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import sessionShare from "./session-share.ts";

const { BUG_REPORT_CUSTOM_ENTRY_TYPE, collectBugReportDiagnostics, collectBugReportMetadata } =
  bugReportModule;
const { clearCrashLog, readCrashLog } = crashLog;
const { serializeSessionBranch } = sessionExport;
const { createShareTrailingEntries } = sessionShare;

function buildBundle(
  session: agentSessionTypes.AgentSession,
  options: bugReportInternalTypes.BugReportOptions,
  summary: string | undefined,
): bugReportTypesModule.BugReportBundle {
  const extensions = session.resourceLoader.getExtensions();
  return {
    diagnostics: collectBugReportDiagnostics(session.sessionManager, readCrashLog()),
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
): void {
  session.sessionManager.appendCustomEntry(BUG_REPORT_CUSTOM_ENTRY_TYPE, {
    createdAt: bundle.metadata.createdAt,
    hint: bundle.metadata.hint,
    id: bundle.metadata.id,
    sessionIncluded: bundle.metadata.session.included,
    summaryIncluded: bundle.metadata.session.summaryIncluded,
    ...delivery,
  } satisfies bugReportTypesModule.BugReportSessionEntryData);
  if (bundle.diagnostics.crashes.length > 0) clearCrashLog();
}

const bugReportPart3 = {
  buildBundle,
  recordInSession,
};

export default bugReportPart3;
