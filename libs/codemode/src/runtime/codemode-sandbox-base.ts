import type typesModule from "../types.ts";
import bridge from "./bridge.ts";
import executionModule from "./execution.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import sandboxBaseModule from "./sandbox-base.ts";

const { stringifyJson } = preludeSource;
const { abort, complete, post, startExecution } = executionModule;
const { toCodemodeIdentifier } = bridge;

function serializeStore(
  store: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(store ?? {})) {
    const json = JSON.stringify(value);
    if (json !== undefined) serialized[key] = json;
  }
  return serialized;
}

function checkProperties(seq: number, outcome: typesModule.CodemodeOutcome) {
  const properties = outcome.ok ? undefined : outcome.properties;
  if (
    properties !== undefined &&
    (typeof properties !== "object" || properties === null || Array.isArray(properties))
  ) {
    throw new Error(`The properties of result ${seq} are not an object`);
  }
  return properties;
}

function deliver(
  execution: protocolTypes.Execution,
  seq: number,
  now: number,
  id: number,
  outcome: typesModule.CodemodeOutcome,
) {
  if (execution.finished) return;
  if (!Number.isFinite(now))
    throw new Error(`The clock value of result ${seq} is not a finite number`);
  if (!Number.isInteger(seq) || seq < 1 || execution.delivered.has(seq)) {
    throw new Error(`Result number ${seq} is not a positive integer used once`);
  }
  const pending = execution.pending.get(id);
  if (pending === undefined) throw new Error(`Call ${id} is not waiting for a result`);
  const properties = checkProperties(seq, outcome);
  const payload = outcome.ok ? stringifyJson(outcome.value) : outcome.message;
  const encoded = properties === undefined ? undefined : JSON.stringify(properties);
  execution.delivered.add(seq);
  execution.pending.delete(id);
  complete(pending, outcome.ok);
  const extra = encoded === undefined ? {} : { properties: encoded };
  post(execution, { id, now, ok: outcome.ok, payload, seq, type: "result", ...extra });
}

const DEFAULT_TIMEOUT_MS = 300_000;

function checkRunOptions(options: typesModule.CodemodeRunOptions): void {
  if (!Number.isFinite(options.startedAt) || options.startedAt < 0) {
    throw new Error("startedAt must be a non-negative number of milliseconds since the epoch");
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new Error("seed must be a 32-bit unsigned integer");
  }
  const tools = options.tools ?? [];
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    throw new Error("Tool names must be unique");
  const scriptNames = tools.map((tool) => tool.jsName ?? toCodemodeIdentifier(tool.name));
  if (new Set(scriptNames).size !== tools.length)
    throw new Error("Tool script names must be unique");
  sandboxBaseModule.checkGlobals(options.globals ?? []);
}

export default class CodemodeSandboxBase {
  private readonly toolsByName = new Map<string, typesModule.CodemodeTool>();
  private readonly globalsByName = new Map<string, typesModule.CodemodeTool>();
  private readonly timeoutMs: number;
  private readonly memoryLimitBytes: number | undefined;
  private readonly launch: protocolTypes.VmLauncher;
  private readonly running = new Set<protocolTypes.Execution>();
  private closed = false;

  constructor(options: typesModule.CodemodeSandboxBaseOptions, launch: protocolTypes.VmLauncher) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.memoryLimitBytes = options.memoryLimitBytes;
    this.launch = launch;
    for (const tool of options.tools ?? []) this.registerTool(tool);
    sandboxBaseModule.checkGlobals(options.globals ?? []);
    for (const global of options.globals ?? []) this.globalsByName.set(global.name, global);
  }

  registerTool(tool: typesModule.CodemodeTool): void {
    if (this.toolsByName.has(tool.name))
      throw new Error(`Tool "${tool.name}" is already registered`);
    this.toolsByName.set(tool.name, tool);
  }

  unregisterTool(name: string): boolean {
    return this.toolsByName.delete(name);
  }

  get tools(): typesModule.CodemodeTool[] {
    return [...this.toolsByName.values()];
  }

  get globals(): typesModule.CodemodeTool[] {
    return [...this.globalsByName.values()];
  }

  execute(
    code: string,
    options: typesModule.CodemodeExecuteOptions = {},
  ): Promise<typesModule.CodemodeResult> {
    if (this.closed) return Promise.reject(new Error("Sandbox is closed"));
    const tools = new Map(this.toolsByName);
    const execution = startExecution({
      code,
      executors: { globals: this.globalsByName, tools },
      globals: [...this.globalsByName.values()],
      launch: this.launch,
      memoryLimitBytes: this.memoryLimitBytes,
      signal: options.signal,
      store: serializeStore(options.store),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      tools: [...tools.values()],
    });
    this.running.add(execution);
    return execution.promise.finally(() => this.running.delete(execution));
  }

  start(code: string, options: typesModule.CodemodeRunOptions): typesModule.CodemodeRun {
    if (this.closed) throw new Error("Sandbox is closed");
    checkRunOptions(options);
    const execution = startExecution({
      code,
      control: { onCall: options.onCall, onIdle: options.onIdle, onStarted: options.onStarted },
      deterministic: { seed: options.seed, startedAt: options.startedAt },
      executors: { globals: new Map(), tools: new Map() },
      globals: options.globals ?? [],
      launch: this.launch,
      memoryLimitBytes: this.memoryLimitBytes,
      signal: options.signal,
      store: serializeStore(options.store),
      timeoutMs: options.timeoutMs ?? Number.POSITIVE_INFINITY,
      tools: options.tools ?? [],
    });
    this.running.add(execution);
    const result = execution.promise.finally(() => this.running.delete(execution));
    return {
      deliver: (seq, now, id, outcome) => deliver(execution, seq, now, id, outcome),
      get finished() {
        return execution.finished;
      },
      result,
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.all(
      [...this.running].map((execution) => abort(execution, "Sandbox closed")),
    ).then(() => undefined);
  }
}
