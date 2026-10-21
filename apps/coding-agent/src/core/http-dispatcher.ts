import * as undici from "undici";

import platform from "./platform/index.ts";
import EventEmitter from "./platform/node/events.ts";

const { readEnv } = platform;

const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

const HTTP_IDLE_TIMEOUT_CHOICES = [
  { label: "30 sec", timeoutMs: 30_000 },
  { label: "1 min", timeoutMs: 60_000 },
  { label: "2 min", timeoutMs: 120_000 },
  { label: "5 min", timeoutMs: 300_000 },
  { label: "disabled", timeoutMs: 0 },
] as const;

const originalGlobalFetch = globalThis.fetch;
let installedGlobalFetch: typeof globalThis.fetch | undefined;

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") {
      return 0;
    }
    if (trimmed.length === 0) {
      return undefined;
    }
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function formatHttpIdleTimeoutMs(timeoutMs: number): string {
  const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs);
  if (choice !== undefined) {
    return choice.label;
  }
  return `${timeoutMs / 1000} sec`;
}

function applyHttpProxySettings(httpProxy: string | undefined): void {
  const proxy = httpProxy?.trim();
  if (proxy === undefined || proxy === "") return;
  if (readEnv("HTTP_PROXY") === undefined) Reflect.set(process.env, "HTTP_PROXY", proxy);
  if (readEnv("HTTPS_PROXY") === undefined) Reflect.set(process.env, "HTTPS_PROXY", proxy);
}

const ignoreUndiciDispatcherError = (_error: unknown): void => {};

function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }
  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

function configureHttpDispatcher(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }
  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      connect: {
        autoSelectFamilyAttemptTimeout: DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
      },
      factory: createUndiciOriginDispatcher,
      headersTimeout: normalizedTimeoutMs,
      proxyTunnel: true,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);
  const shouldInstallGlobals =
    installedGlobalFetch === undefined
      ? globalThis.fetch === originalGlobalFetch
      : globalThis.fetch === installedGlobalFetch;
  if (shouldInstallGlobals) {
    undici.install?.();
    installedGlobalFetch = globalThis.fetch;
  }
}

const httpDispatcher = {
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  HTTP_IDLE_TIMEOUT_CHOICES,
  applyHttpProxySettings,
  configureHttpDispatcher,
  formatHttpIdleTimeoutMs,
  parseHttpIdleTimeoutMs,
};

export default httpDispatcher;
