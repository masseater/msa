import process from "node:process";

import crossSpawn from "cross-spawn";
import { Effect } from "effect";

import { foreign, type McpForeignError, toPromise } from "../foreign.ts";
import {
  type JsonRpcMessage,
  McpConnectionClosedError,
  parseJsonRpcMessage,
} from "../protocol/jsonrpc.ts";
import { schedule } from "../timer.ts";
import { McpTransportError } from "./errors/transport-error.ts";
import { DEFAULT_MAX_MESSAGE_BYTES, type McpTransport, TransportEvents } from "./transport.ts";

const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const STDIN_CLOSE_GRACE_MS = 500;
const USE_PROCESS_GROUPS = process.platform !== "win32";

type ChildProcess = ReturnType<typeof crossSpawn>;

const liveProcessGroups = new Set<number>();
let exitHookInstalled = false;

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (process.platform === "win32" && pid !== undefined) {
    if (child.exitCode !== null) return;
    crossSpawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => undefined);
    return;
  }
  if (USE_PROCESS_GROUPS && pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const pid of liveProcessGroups) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}
    }
  });
}

export interface StdioTransportOptions {
  command: string;
  args?: readonly string[] | undefined;
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  stderr?: "pipe" | "inherit";
  onStderr?: (chunk: string) => void;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
  closeTimeoutMs?: number;
}

type StartFailure = McpForeignError | McpTransportError | McpConnectionClosedError;

const waitForSpawn = (child: ChildProcess): Effect.Effect<void, McpForeignError> =>
  Effect.callback<void, McpForeignError>((resume) => {
    const onSpawn = () => {
      child.off("error", onError);
      resume(Effect.void);
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      resume(Effect.fail(foreign(error)));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });

export class StdioTransport extends TransportEvents implements McpTransport {
  readonly options: Readonly<StdioTransportOptions>;
  private child: ChildProcess | undefined;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private started = false;
  private closed = false;

  constructor(options: StdioTransportOptions) {
    super();
    this.options = Object.freeze({
      ...options,
      args: options.args === undefined ? undefined : [...options.args],
    });
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get stderr(): string {
    return this.stderrBuffer.toString("utf8");
  }

  start(): Promise<void> {
    return toPromise(
      Effect.suspend((): Effect.Effect<void, StartFailure> => {
        if (this.started)
          return Effect.fail(new McpTransportError("MCP stdio transport already started"));
        if (this.closed) return Effect.fail(new McpConnectionClosedError());
        this.started = true;
        const child = this.spawnChild();
        return waitForSpawn(child).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              child.on("error", (error) => {
                if (!this.closed) this.emitError(error);
              });
            }),
          ),
        );
      }),
    );
  }

  send(message: JsonRpcMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!this.started || this.closed || stdin === null || stdin === undefined || !stdin.writable)
      return toPromise(Effect.fail(new McpConnectionClosedError()));
    const payload = `${JSON.stringify(message)}\n`;
    return toPromise(
      Effect.callback<void, McpForeignError>((resume) => {
        stdin.write(payload, (error) =>
          resume(error === null || error === undefined ? Effect.void : Effect.fail(foreign(error))),
        );
      }),
    );
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    const child = this.child;
    if (child === undefined) {
      this.emitClose();
      return Promise.resolve();
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      child.stdin?.end();
      return Promise.resolve();
    }
    const closeTimeoutMs = this.options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    return toPromise(
      Effect.callback<void>((resume) => {
        const grace = Math.min(STDIN_CLOSE_GRACE_MS, closeTimeoutMs);
        const cancels: (() => void)[] = [];
        child.once("close", () => {
          for (const cancel of cancels) cancel();
          killProcessTree(child, "SIGTERM");
          resume(Effect.void);
        });
        cancels.push(schedule(grace, () => killProcessTree(child, "SIGTERM")));
        cancels.push(schedule(grace + closeTimeoutMs, () => killProcessTree(child, "SIGKILL")));
        child.stdin?.end();
      }),
    );
  }

  private spawnChild(): ChildProcess {
    const env =
      this.options.inheritEnv === false
        ? { ...this.options.env }
        : { ...process.env, ...this.options.env };
    const child = crossSpawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", this.options.stderr === "inherit" ? "inherit" : "pipe"],
      windowsHide: true,
      detached: USE_PROCESS_GROUPS,
    });
    this.child = child;
    const pid = child.pid;
    if (USE_PROCESS_GROUPS && pid !== undefined) {
      installExitHook();
      liveProcessGroups.add(pid);
      child.once("exit", () => liveProcessGroups.delete(pid));
    }
    child.stdout?.on("data", (chunk: Buffer | string) => this.handleStdout(chunk));
    child.stdout?.on("error", (error) => this.emitError(error));
    child.stdin?.on("error", (error) => {
      if (!this.closed) this.emitError(error);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => this.handleStderr(chunk));
    child.stderr?.on("error", (error) => this.emitError(error));
    child.on("close", () => {
      this.child = undefined;
      if (this.stdoutBuffer.toString("utf8").trim() !== "") {
        this.emitError(new Error("MCP stdio server closed with an incomplete JSON-RPC message"));
      }
      this.stdoutBuffer = Buffer.alloc(0);
      this.emitClose();
    });
    return child;
  }

  private handleStdout(chunk: Buffer | string): void {
    this.stdoutBuffer = Buffer.concat([
      this.stdoutBuffer,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    const maxMessageBytes = this.options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.stdoutBuffer.length > maxMessageBytes) {
          this.stdoutBuffer = Buffer.alloc(0);
          this.emitError(new Error(`MCP stdio message exceeds ${maxMessageBytes} bytes`));
        }
        return;
      }
      const line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.length > maxMessageBytes) {
        this.emitError(new Error(`MCP stdio message exceeds ${maxMessageBytes} bytes`));
        continue;
      }
      const text = line.toString("utf8").replace(/\r$/u, "");
      if (text.trim() === "") continue;
      try {
        this.emitMessage(parseJsonRpcMessage(JSON.parse(text)));
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  private handleStderr(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const maxStderrBytes = this.options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, buffer]);
    if (this.stderrBuffer.length > maxStderrBytes)
      this.stderrBuffer = this.stderrBuffer.subarray(-maxStderrBytes);
    this.options.onStderr?.(buffer.toString("utf8"));
  }
}
