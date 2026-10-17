import { toCodemodeIdentifier } from "../identifier.ts";
import type {
  CodemodeExecuteOptions,
  CodemodeResult,
  CodemodeRun,
  CodemodeRunOptions,
  CodemodeSandboxBaseOptions,
  CodemodeTool,
} from "../types.ts";
import { serializeStore } from "./bridge.ts";
import { Execution } from "./execution.ts";
import { checkGlobals } from "./globals.ts";
import type { VmLauncher } from "./launcher.ts";

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
    const execution = new Execution({
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
    const execution = new Execution({
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
      deliver: (seq, now, id, outcome) => execution.deliver(seq, now, id, outcome),
      get finished() {
        return execution.finished;
      },
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.all(
      [...this.running].map((execution) => execution.abort("Sandbox closed")),
    ).then(() => undefined);
  }
}
