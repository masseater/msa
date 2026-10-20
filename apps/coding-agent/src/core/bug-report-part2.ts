import ai from "@msa/ai";

import zip from "../utils/zip.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart1 from "./bug-report-part1.ts";
import type bugReportTypes from "./bug-report.types.ts";
import type crashLogTypes from "./crash-log.types.ts";
import platformModule from "./platform.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { nowIso } = platformModule;
const { uuidv7 } = ai;
const { writeZipArchive } = zip;
const {
  BUG_REPORT_SCHEMA_VERSION,
  collectEnvironment,
  describeExtension,
  describeModel,
  describeProvider,
  redactSettings,
} = bugReportPart1;

function collectBugReportMetadata(options: bugReportInternalTypes.CollectBugReportMetadataOptions) {
  const hint = options.hint?.trim() || null;
  const provider =
    options.model === undefined
      ? undefined
      : options.modelRuntime.getProvider(options.model.provider);
  return {
    createdAt: nowIso(),
    environment: collectEnvironment(),
    extensionErrors: options.extensionErrors.map(({ path, error }) => ({ error, path })),
    extensions: options.extensions.map(describeExtension),
    hint,
    id: options.id ?? uuidv7(),
    model: options.model === undefined ? null : describeModel(options.model),
    provider: provider === undefined ? null : describeProvider(options.modelRuntime, provider),
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    session: {
      id: options.sessionId,
      included: options.includeSession,
      messageCount: options.messageCount,
      summaryIncluded: options.includeSummary,
      ...(options.includeSession ? { cwd: options.cwd } : {}),
    },
    settings: {
      global: redactSettings(options.globalSettings),
      project: redactSettings(options.projectSettings),
    },
    thinkingLevel: options.thinkingLevel,
  };
}

function collectBugReportDiagnostics(
  sessionManager: sessionManagerTypes.ReadonlySessionManager,
  crashes: readonly crashLogTypes.CrashRecord[] = [],
) {
  const entries = sessionManager.getEntries();
  const assistant = [];
  let assistantMessageCount = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    assistantMessageCount++;
    const message = entry.message;
    const diagnostics = message.diagnostics ?? [];
    if (
      diagnostics.length === 0 &&
      message.stopReason !== "error" &&
      message.stopReason !== "aborted" &&
      (message.errorMessage === undefined || message.errorMessage === "")
    ) {
      continue;
    }
    assistant.push({
      api: message.api,
      entryId: entry.id,
      model: message.model,
      provider: message.provider,
      stopReason: message.stopReason,
      timestamp: entry.timestamp,
      ...(message.rawStopReason === undefined ? {} : { rawStopReason: message.rawStopReason }),
      ...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
      diagnostics,
    });
  }
  return {
    assistant,
    assistantMessageCount,
    crashes: crashes.map(({ notified: _notified, ...record }) => record),
    entryCount: entries.length,
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    sessionId: sessionManager.getSessionId(),
  };
}

function bugReportFiles(
  bundle: bugReportTypes.BugReportBundle,
): bugReportInternalTypes.BugReportFile[] {
  const files: bugReportInternalTypes.BugReportFile[] = [
    {
      contentType: "application/json",
      data: `${JSON.stringify(bundle.metadata, null, 2)}\n`,
      name: "report.json",
    },
    {
      contentType: "application/json",
      data: `${JSON.stringify(bundle.diagnostics, null, 2)}\n`,
      name: "diagnostics.json",
    },
  ];
  if (bundle.sessionJsonl !== undefined) {
    files.push({
      contentType: "application/x-ndjson",
      data: bundle.sessionJsonl,
      name: "session.jsonl",
    });
  }
  if (bundle.summary !== undefined) {
    files.push({
      contentType: "text/markdown",
      data: bundle.summary.endsWith("\n") ? bundle.summary : `${bundle.summary}\n`,
      name: "summary.md",
    });
  }
  return files;
}

function writeBugReportArchive(
  bundle: bugReportTypes.BugReportBundle,
  filePath: string,
): Promise<void> {
  return writeZipArchive(filePath, bugReportFiles(bundle));
}

function bugReportArchiveFileName(id: string): string {
  return `msa-bug-report-${id}.zip`;
}

const BUG_SUMMARY_SYSTEM_PROMPT = `You are helping a user file a bug report about msa, the coding agent they are talking to. You will be shown the conversation transcript. Write a report for the msa developers describing what the user was doing and what went wrong.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the report.`;

const BUG_SUMMARY_INSTRUCTIONS = `Write the bug report in Markdown with these sections:

## What the user was doing
One short paragraph.

## What went wrong
Concrete description of the failure: wrong output, errors, hangs, tool failures, unexpected behavior. Quote error messages and tool output verbatim where they exist.

## Steps to reproduce
Numbered list, as specific as the transcript allows.

## Relevant details
Tool calls involved, files touched, model behavior, anything else that helps a developer reproduce or locate the problem.

Do not include file contents, secrets, or credentials from the transcript; refer to files by path only. Keep the report factual and concise.`;

const bugReportPart2 = {
  BUG_SUMMARY_INSTRUCTIONS,
  BUG_SUMMARY_SYSTEM_PROMPT,
  bugReportArchiveFileName,
  collectBugReportDiagnostics,
  collectBugReportMetadata,
  writeBugReportArchive,
};

export default bugReportPart2;
