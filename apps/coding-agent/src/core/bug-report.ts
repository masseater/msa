import * as os from "node:os";

import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { VERSION } from "../config.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { writeZipArchive } from "../utils/zip.ts";
import { awaited, awaiting } from "./awaiting.ts";
import {
  completeSummarization,
  estimateTokens,
  getSummarizationFailure,
} from "./compaction/compaction.ts";
import { serializeConversation } from "./compaction/utils.ts";
import type { CrashRecord } from "./crash-log.ts";
import type { Extension } from "./extensions/types.ts";
import { convertToLlm } from "./messages.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { nowIso, nowMs } from "./platform.ts";
import { envNames, readEnv } from "./process-env.ts";
import type { ReadonlySessionManager } from "./session-manager.ts";
import type { Settings } from "./settings-manager.ts";

const { contentText, normalizeContext, uuidv7 } = ai;

export const BUG_REPORT_CUSTOM_ENTRY_TYPE = "msa.bug-report";
const BUG_REPORT_SCHEMA_VERSION = 1;
const REDACTED = "<redacted>";
const SENSITIVE_KEY =
  /(?:^|[-_])(api[-_]?key|secret|token|password|passwd|credential|authorization|cookie)(?:$|[-_])/iu;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2"));
}

export function redactUrl(value: string): string {
  const nested = /^([a-z][a-z0-9+.-]*:)([a-z][a-z0-9+.-]*:\/\/.*)$/iu.exec(value);
  const [, scheme, inner] = nested ?? [];
  if (scheme !== undefined && inner !== undefined) return `${scheme}${redactUrl(inner)}`;
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
      changed = true;
    }
    for (const key of url.searchParams.keys()) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

export function redactJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, child: unknown) => {
      if (child !== null && child !== undefined && isSensitiveKey(key)) return REDACTED;
      return typeof child === "string" ? redactUrl(child) : child;
    }),
  );
}

function redactSettings(settings: Settings): Settings {
  const { trackingId: _trackingId, deviceId: _deviceId, ...rest } = settings;
  return redactJsonValue(rest) as Settings;
}

function collectEnvironment() {
  const env = (name: string): string | null => readEnv(name) || null;
  return {
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    piEnvironmentVariables: envNames()
      .filter((name) => name.startsWith("MSA_"))
      .sort(),
    platform: process.platform,
    runtime:
      process.versions["bun"] !== undefined && process.versions["bun"] !== ""
        ? `bun/${process.versions["bun"]}`
        : `node/${process.version}`,
    shell: readEnv("SHELL")?.split(/[\\/]/u).pop() || null,
    terminal: {
      ci: Boolean(readEnv("CI")),
      colorterm: env("COLORTERM"),
      program: env("TERM_PROGRAM"),
      programVersion: env("TERM_PROGRAM_VERSION"),
      ssh: Boolean(readEnv("SSH_CONNECTION") || readEnv("SSH_CLIENT") || readEnv("SSH_TTY")),
      term: env("TERM"),
      tmux: Boolean(readEnv("TMUX")),
    },
    userAgent: getMsaUserAgent(VERSION),
    version: VERSION,
  };
}

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

function describeProvider(modelRuntime: ModelRuntime, provider: compatTypes.Provider) {
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

function describeExtension(extension: Extension) {
  return {
    hidden: extension.hidden === true,
    origin: extension.sourceInfo.origin,
    path: extension.path,
    scope: extension.sourceInfo.scope,
    source: redactUrl(extension.sourceInfo.source),
  };
}

interface CollectBugReportMetadataOptions {
  id?: string | undefined;
  hint?: string | undefined;
  sessionId: string;
  cwd: string;
  includeSession: boolean;
  includeSummary: boolean;
  messageCount: number;
  model?: compatTypes.Model<compatTypes.Api> | undefined;
  modelRuntime: ModelRuntime;
  thinkingLevel: agentTypes.ThinkingLevel;
  extensions: readonly Extension[];
  extensionErrors: ReadonlyArray<{ path: string; error: string }>;
  globalSettings: Settings;
  projectSettings: Settings;
}

export function collectBugReportMetadata(options: CollectBugReportMetadataOptions) {
  const hint = options.hint?.trim() || null;
  const provider =
    options.model === undefined
      ? undefined
      : options.modelRuntime.getProvider(options.model.provider);
  return {
    createdAt: nowIso(),
    environment: collectEnvironment(),
    extensionErrors: options.extensionErrors.map(({ path, error }) => ({ path, error })),
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

export function collectBugReportDiagnostics(
  sessionManager: ReadonlySessionManager,
  crashes: readonly CrashRecord[] = [],
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
      entryId: entry.id,
      timestamp: entry.timestamp,
      provider: message.provider,
      model: message.model,
      api: message.api,
      stopReason: message.stopReason,
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

export type BugReportMetadata = ReturnType<typeof collectBugReportMetadata>;
export type BugReportDiagnostics = ReturnType<typeof collectBugReportDiagnostics>;

export interface BugReportBundle {
  metadata: BugReportMetadata;
  diagnostics: BugReportDiagnostics;
  sessionJsonl?: string | undefined;
  summary?: string | undefined;
}

export interface BugReportSessionEntryData {
  id: string;
  createdAt: string;
  hint: string | null;
  sessionIncluded: boolean;
  summaryIncluded: boolean;
  delivery: "zip";
  path?: string;
}

interface BugReportFile {
  name: string;
  contentType: string;
  data: string;
}

function bugReportFiles(bundle: BugReportBundle): BugReportFile[] {
  const files: BugReportFile[] = [
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

export function writeBugReportArchive(bundle: BugReportBundle, filePath: string): Promise<void> {
  return writeZipArchive(filePath, bugReportFiles(bundle));
}

export function bugReportArchiveFileName(id: string): string {
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

function selectMessages(
  messages: readonly agentTypes.AgentMessage[],
  tokenBudget: number,
): agentTypes.AgentMessage[] {
  const selected: agentTypes.AgentMessage[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message === undefined) continue;
    const next = estimateTokens(message);
    if (selected.length > 0 && tokens + next > tokenBudget) break;
    selected.push(message);
    tokens += next;
  }
  return selected.reverse();
}

interface GenerateBugReportSummaryOptions {
  messages: readonly agentTypes.AgentMessage[];
  hint?: string | undefined;
  model: compatTypes.Model<compatTypes.Api>;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
  signal: AbortSignal;
  thinkingLevel?: agentTypes.ThinkingLevel;
  streamFn?: agentTypes.StreamFn;
  retry?: aiTypes.RetryPolicy;
  sessionId?: string;
}

export function generateBugReportSummary(
  options: GenerateBugReportSummaryOptions,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const { model } = options;
      const contextWindow = model.contextWindow > 0 ? model.contextWindow : 128_000;
      const messages = selectMessages(options.messages, Math.floor(contextWindow * 0.6));
      const hint = options.hint?.trim();
      const prompt = [
        messages.length < options.messages.length
          ? `Note: only the last ${messages.length} of ${options.messages.length} messages are shown.`
          : undefined,
        `<conversation>\n${serializeConversation(convertToLlm(messages))}\n</conversation>`,
        hint !== undefined && hint !== "" ? `<user-report>\n${hint}\n</user-report>` : undefined,
        BUG_SUMMARY_INSTRUCTIONS,
      ]
        .filter((part) => part !== undefined)
        .join("\n\n");
      const requestOptions: compatTypes.SimpleStreamOptions = {
        apiKey: options.apiKey,
        env: options.env,
        headers: options.headers,
        maxTokens: Math.min(4096, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY),
        sessionId: options.sessionId,
        signal: options.signal,
        ...(model.reasoning &&
        options.thinkingLevel !== undefined &&
        options.thinkingLevel !== "off"
          ? { reasoning: options.thinkingLevel }
          : {}),
      };
      const response = yield* awaited(
        completeSummarization(
          model,
          normalizeContext({
            messages: [
              { role: "user", content: [{ type: "text", text: prompt }], timestamp: nowMs() },
            ],
            systemPrompt: BUG_SUMMARY_SYSTEM_PROMPT,
          }),
          requestOptions,
          options.streamFn,
          options.retry,
        ),
      );
      if (response.stopReason === "aborted") throw new Error("Bug report summary was cancelled");
      const failure = getSummarizationFailure(response, "Bug report summary");
      if (failure !== undefined && failure !== "") throw new Error(failure);
      if (response.content.some((block) => block.type === "toolCall")) {
        throw new Error("Bug report summary attempted to call a tool");
      }
      const text = contentText(response.content, "\n").trim();
      if (text === "") throw new Error("Bug report summary was empty");
      return text;
    }),
  );
}
