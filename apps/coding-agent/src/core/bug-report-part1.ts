import * as os from "node:os";

import type compatTypes from "@msa/ai/compat.types";

import config from "../config.ts";
import userAgentModule from "../utils/user-agent.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import processEnv from "./process-env.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { envNames, readEnv } = processEnv;
const { getMsaUserAgent } = userAgentModule;
const { VERSION } = config;

const BUG_REPORT_CUSTOM_ENTRY_TYPE = "msa.bug-report";

const BUG_REPORT_SCHEMA_VERSION = 1;

const REDACTED = "<redacted>";

const SENSITIVE_KEY =
  /(?:^|[-_])(api[-_]?key|secret|token|password|passwd|credential|authorization|cookie)(?:$|[-_])/iu;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2"));
}

function redactUrl(value: string): string {
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

function redactJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, child: unknown) => {
      if (child !== null && child !== undefined && isSensitiveKey(key)) return REDACTED;
      return typeof child === "string" ? redactUrl(child) : child;
    }),
  );
}

function redactSettings(settings: settingsManagerTypes.Settings): settingsManagerTypes.Settings {
  const { trackingId: _trackingId, deviceId: _deviceId, ...rest } = settings;
  return redactJsonValue(rest) as settingsManagerTypes.Settings;
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

const bugReportPart1 = {
  BUG_REPORT_CUSTOM_ENTRY_TYPE,
  BUG_REPORT_SCHEMA_VERSION,
  collectEnvironment,
  describeExtension,
  describeModel,
  describeProvider,
  redactJsonValue,
  redactSettings,
  redactUrl,
};

export default bugReportPart1;
