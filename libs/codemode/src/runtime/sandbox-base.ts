import type {
  CodemodeDeclaredGlobal,
  CodemodeExecuteOptions,
  CodemodeOutcome,
  CodemodeResult,
  CodemodeRun,
  CodemodeRunOptions,
  CodemodeSandboxBaseOptions,
  CodemodeTool,
} from "../types.ts";
import { toCodemodeIdentifier } from "./bridge.ts";
import { abort, complete, post, startExecution } from "./execution.ts";
import { stringifyJson } from "./prelude-source.ts";
import type { Execution, VmLauncher } from "./protocol.ts";

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

function checkProperties(seq: number, outcome: CodemodeOutcome) {
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
  execution: Execution,
  seq: number,
  now: number,
  id: number,
  outcome: CodemodeOutcome,
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
  post(execution, { type: "result", id, ok: outcome.ok, payload, seq, now, ...extra });
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const RESERVED_GLOBALS: ReadonlySet<string> = new Set([
  "tools",
  "ALL_TOOLS",
  "console",
  "text",
  "image",
  "exit",
  "globalThis",
  "store",
  "load",
]);

export function checkGlobals(globals: readonly CodemodeDeclaredGlobal[]): void {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const global of globals) {
    const parts = global.name.split(".");
    const [root] = parts;
    if (
      root === undefined ||
      parts.length > 2 ||
      !parts.every((part) => IDENTIFIER.test(part)) ||
      RESERVED_GLOBALS.has(root)
    ) {
      throw new Error(`Invalid global name "${global.name}"`);
    }
    if (names.has(global.name)) throw new Error(`Global "${global.name}" is already registered`);
    if (parts.length === 2) namespaces.add(root);
    names.add(global.name);
  }
  for (const name of namespaces) {
    if (names.has(name)) throw new Error(`Global "${name}" conflicts with the namespace "${name}"`);
  }
}

const DEFAULT_TIMEOUT_MS = 300_000;

function checkRunOptions(options: CodemodeRunOptions): void {
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
  checkGlobals(options.globals ?? []);
}

export class CodemodeSandboxBase {
  private readonly toolsByName = new Map<string, CodemodeTool>();
  private readonly globalsByName = new Map<string, CodemodeTool>();
  private readonly timeoutMs: number;
  private readonly memoryLimitBytes: number | undefined;
  private readonly launch: VmLauncher;
  private readonly running = new Set<Execution>();
  private closed = false;

  constructor(options: CodemodeSandboxBaseOptions, launch: VmLauncher) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.memoryLimitBytes = options.memoryLimitBytes;
    this.launch = launch;
    for (const tool of options.tools ?? []) this.registerTool(tool);
    checkGlobals(options.globals ?? []);
    for (const global of options.globals ?? []) this.globalsByName.set(global.name, global);
  }

  registerTool(tool: CodemodeTool): void {
    if (this.toolsByName.has(tool.name))
      throw new Error(`Tool "${tool.name}" is already registered`);
    this.toolsByName.set(tool.name, tool);
  }

  unregisterTool(name: string): boolean {
    return this.toolsByName.delete(name);
  }

  get tools(): CodemodeTool[] {
    return [...this.toolsByName.values()];
  }

  get globals(): CodemodeTool[] {
    return [...this.globalsByName.values()];
  }

  execute(code: string, options: CodemodeExecuteOptions = {}): Promise<CodemodeResult> {
    if (this.closed) return Promise.reject(new Error("Sandbox is closed"));
    const tools = new Map(this.toolsByName);
    const execution = startExecution({
      code,
      tools: [...tools.values()],
      globals: [...this.globalsByName.values()],
      executors: { tools, globals: this.globalsByName },
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      signal: options.signal,
      memoryLimitBytes: this.memoryLimitBytes,
      store: serializeStore(options.store),
      launch: this.launch,
    });
    this.running.add(execution);
    return execution.promise.finally(() => this.running.delete(execution));
  }

  start(code: string, options: CodemodeRunOptions): CodemodeRun {
    if (this.closed) throw new Error("Sandbox is closed");
    checkRunOptions(options);
    const execution = startExecution({
      code,
      tools: options.tools ?? [],
      globals: options.globals ?? [],
      executors: { tools: new Map(), globals: new Map() },
      timeoutMs: options.timeoutMs ?? Number.POSITIVE_INFINITY,
      signal: options.signal,
      memoryLimitBytes: this.memoryLimitBytes,
      store: serializeStore(options.store),
      deterministic: { startedAt: options.startedAt, seed: options.seed },
      control: { onStarted: options.onStarted, onCall: options.onCall, onIdle: options.onIdle },
      launch: this.launch,
    });
    this.running.add(execution);
    const result = execution.promise.finally(() => this.running.delete(execution));
    return {
      result,
      deliver: (seq, now, id, outcome) => deliver(execution, seq, now, id, outcome),
      get finished() {
        return execution.finished;
      },
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.all(
      [...this.running].map((execution) => abort(execution, "Sandbox closed")),
    ).then(() => undefined);
  }
}
