import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";

import bugReportEnvironment from "./bug-report-environment.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportRedaction from "./bug-report-redaction.ts";
import type crashLogTypes from "./crash-log.types.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import platformModule from "./platform.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { redactSettings, redactJsonValue, redactUrl } = bugReportRedaction;
const { uuidv7 } = ai;
const { nowIso } = platformModule;
const { collectEnvironment } = bugReportEnvironment;

const BUG_REPORT_CUSTOM_ENTRY_TYPE = "msa.bug-report";

const BUG_REPORT_SCHEMA_VERSION = 1;

function describeModel(model: compatTypes.Model<compatTypes.Api>) {
  return {
    api: model.api,
    baseUrl: redactUrl(model.baseUrl),
    compat: model.compat === undefined ? null : redactJsonValue(model.compat),
    contextWindow: model.contextWindow,
    headerNames: Object.keys(model.headers ?? {}).sort(),
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning,
    samplingParams:
      model.samplingParams === undefined ? null : redactJsonValue(model.samplingParams),
    thinkingLevelMap: model.thinkingLevelMap ?? null,
  };
}

function describeProvider(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  provider: compatTypes.Provider,
) {
  const authTypes: Array<"api_key" | "oauth"> = [];
  if (provider.auth.apiKey !== undefined) authTypes.push("api_key");
  if (provider.auth.oauth !== undefined) authTypes.push("oauth");
  return {
    authStatus: modelRuntime.getProviderAuthStatus(provider.id),
    authTypes,
    baseUrl:
      provider.baseUrl !== undefined && provider.baseUrl !== ""
        ? redactUrl(provider.baseUrl)
        : null,
    headerNames: Object.keys(provider.headers ?? {}).sort(),
    id: provider.id,
    name: provider.name,
    registeredByExtension: modelRuntime.getRegisteredProviderIds().includes(provider.id),
    usingOAuth: modelRuntime.isUsingOAuth(provider.id),
  };
}

function describeExtension(extension: extensionsTypesTypes.Extension) {
  return {
    hidden: extension.hidden === true,
    origin: extension.sourceInfo.origin,
    path: extension.path,
    scope: extension.sourceInfo.scope,
    source: redactUrl(extension.sourceInfo.source),
  };
}

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

const bugReportMetadata = {
  BUG_REPORT_CUSTOM_ENTRY_TYPE,
  collectBugReportDiagnostics,
  collectBugReportMetadata,
};

export default bugReportMetadata;
