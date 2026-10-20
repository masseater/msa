declare namespace typesModule {
  type CodemodeWasmModule = object;

  interface CodemodeToolContext {
    signal: AbortSignal;
  }

  type CodemodeJsonSchema = { [key: string]: unknown } | boolean;

  interface CodemodeTool {
    name: string;
    description?: string;
    inputSchema?: CodemodeJsonSchema;
    outputSchema?: CodemodeJsonSchema;
    spread?: boolean;
    signature?: string;
    execute(args: unknown, context: CodemodeToolContext): Promise<unknown> | unknown;
  }

  type CodemodeOutputItem =
    | { type: "text"; text: string; console?: true }
    | { type: "image"; data: string; mimeType: string };

  type CodemodeCallStatus = "ok" | "error" | "cancelled";

  interface CodemodeCall {
    name: string;
    status: CodemodeCallStatus;
    durationMs: number;
  }

  type CodemodeErrorKind = "script" | "timeout" | "aborted" | "sandbox";

  interface CodemodeError {
    kind: CodemodeErrorKind;
    name?: string | undefined;
    message: string;
    stack?: string | undefined;
  }

  interface CodemodeStoreWrites {
    set: Record<string, unknown>;
    delete: string[];
  }

  type CodemodeResult =
    | {
        ok: true;
        value: unknown;
        output: CodemodeOutputItem[];
        calls: CodemodeCall[];
        storeWrites: CodemodeStoreWrites;
        during?: CodemodeDuring;
      }
    | {
        ok: false;
        error: CodemodeError;
        output: CodemodeOutputItem[];
        calls: CodemodeCall[];
        during?: CodemodeDuring;
      };

  interface CodemodeSandboxBaseOptions {
    tools?: CodemodeTool[];
    globals?: CodemodeTool[];
    timeoutMs?: number;
    memoryLimitBytes?: number;
  }

  interface CodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
    wasm?: CodemodeWasmModule | Promise<CodemodeWasmModule>;
    workerUrl?: string | URL;
    acquireWorker?(): () => void;
    onWorkerStarted?(exited: Promise<void>): void;
  }

  interface CodemodeHostCall {
    id: number;
    target: "tool" | "global";
    name: string;
    args: unknown;
  }

  interface CodemodeDeclaredTool {
    name: string;
    jsName?: string;
    description?: string;
  }

  interface CodemodeDeclaredGlobal {
    name: string;
    spread?: boolean;
  }

  type CodemodeOutcome =
    | { ok: true; value: unknown }
    | { ok: false; message: string; properties?: Record<string, unknown> };

  interface CodemodeDuring {
    seq: number;
    issued: number;
  }

  interface CodemodeRunOptions {
    startedAt: number;
    seed: number;
    tools?: CodemodeDeclaredTool[];
    globals?: CodemodeDeclaredGlobal[];
    store?: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
    timeoutMs?: number;
    onStarted?(fingerprint: string): void;
    onCall(call: CodemodeHostCall): void;
    onIdle?(seq: number, issued: number): void;
  }

  interface CodemodeRun {
    readonly result: Promise<CodemodeResult>;
    readonly finished: boolean;
    deliver(seq: number, now: number, id: number, outcome: CodemodeOutcome): void;
  }

  interface CodemodeExecuteOptions {
    signal?: AbortSignal | undefined;
    timeoutMs?: number;
    store?: Readonly<Record<string, unknown>>;
  }
}

export type { typesModule as default };
