import { Effect } from "effect";

import { StreamDecoder } from "./decode.ts";
import { ExecutionError } from "./execution-error.ts";
import { type ChildExit, exitCodeOf, waitForChildProcess } from "./node-child-wait.ts";
import { killProcessTree, type OsProcess, spawnProcessGroup } from "./node-process.ts";
import { OutputSpill, type SpillHooks, type SpillThreshold } from "./node-spill.ts";
import { cancelTimer, startTimer, type Timer } from "./node-timer.ts";
import { err, ok, type Result, toError } from "./result.ts";
import type { ShellExecOptions, ShellExecResult, ShellOutputInfo } from "./types.ts";

type OnOutput = NonNullable<ShellExecOptions["onOutput"]>;
type Context = Parameters<OnOutput>[1];

type ExecResult = Result<ShellExecResult, ExecutionError>;

export interface ShellRunRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly stdinCommand: string | undefined;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number | undefined;
  readonly timeout: number | undefined;
  readonly context: Context;
  readonly onOutput: OnOutput | undefined;
  readonly spill: SpillThreshold | undefined;
  readonly activeChildPids: Set<number>;
  readonly createTempFile: SpillHooks["createTempFile"];
}

export class ShellRun {
  readonly #request: ShellRunRequest;
  readonly #spill: OutputSpill;
  readonly #decoders: Readonly<Record<ShellOutputInfo["stream"], StreamDecoder>> = {
    stdout: new StreamDecoder(),
    stderr: new StreamDecoder(),
  };
  #child: OsProcess | undefined;
  #timer: Timer | undefined;
  #callbackError: ExecutionError | undefined;
  #settled = false;
  #timedOut = false;

  constructor(request: ShellRunRequest) {
    this.#request = request;
    this.#spill = new OutputSpill({
      pause: this.#pauseOutput,
      resume: this.#resumeOutput,
      abort: this.#abort,
      createTempFile: request.createTempFile,
    });
  }

  get #signal(): AbortSignal | undefined {
    return this.#request.context.abortSignal;
  }

  readonly #abort = (): void => {
    const pid = this.#child?.pid;
    if (pid !== undefined) killProcessTree(pid);
  };

  #failCallback(error: unknown): void {
    if (this.#callbackError !== undefined) return;
    const cause = toError(error);
    this.#callbackError = new ExecutionError("callback_error", cause.message, cause);
    this.#abort();
  }

  #emit(text: string, stream: ShellOutputInfo["stream"]): void {
    const onOutput = this.#request.onOutput;
    if (this.#settled || text === "" || onOutput === undefined) return;
    if (this.#callbackError !== undefined) return;
    try {
      onOutput(text, this.#request.context, { stream });
    } catch (error) {
      this.#failCallback(error);
    }
  }

  #settle(result: ExecResult): ExecResult {
    if (this.#settled) return result;
    this.#settled = true;
    cancelTimer(this.#timer);
    this.#signal?.removeEventListener("abort", this.#abort);
    const pid = this.#child?.pid;
    if (pid !== undefined) this.#request.activeChildPids.delete(pid);
    return result;
  }

  readonly #pauseOutput = (): void => {
    this.#child?.stdout?.pause();
    this.#child?.stderr?.pause();
  };

  readonly #resumeOutput = (): void => {
    if (this.#callbackError !== undefined || this.#spill.blocked || this.#timedOut) return;
    if (this.#signal?.aborted === true) return;
    this.#child?.stdout?.resume();
    this.#child?.stderr?.resume();
  };

  #spawn(): OsProcess | ExecutionError {
    const request = this.#request;
    try {
      const child = spawnProcessGroup({
        program: request.program,
        args: request.args,
        cwd: request.cwd,
        env: request.env,
        pipeStdin: request.stdinCommand !== undefined,
      });
      this.#child = child;
      if (child.pid !== undefined) request.activeChildPids.add(child.pid);
      if (request.stdinCommand !== undefined) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(request.stdinCommand);
      }
      return child;
    } catch (error) {
      const cause = toError(error);
      return new ExecutionError("spawn_error", cause.message, cause);
    }
  }

  #watch(child: OsProcess): void {
    const { timeoutMs } = this.#request;
    if (timeoutMs !== undefined) {
      this.#timer = startTimer(timeoutMs, () => {
        this.#timedOut = true;
        this.#abort();
      });
    }
    const signal = this.#signal;
    if (signal !== undefined) {
      if (signal.aborted) this.#abort();
      else signal.addEventListener("abort", this.#abort, { once: true });
    }
    child.stdout?.on("data", this.#feed("stdout"));
    child.stderr?.on("data", this.#feed("stderr"));
  }

  #feed(source: ShellOutputInfo["stream"]): (chunk: Uint8Array) => void {
    const decoder = this.#decoders[source];
    return (chunk) => {
      this.#emit(decoder.decode(chunk), source);
      this.#spill.feed(chunk, this.#request.spill);
    };
  }

  #interruption(): ExecutionError | undefined {
    if (this.#timedOut) return new ExecutionError("timeout", `timeout:${this.#request.timeout}`);
    return this.#signal?.aborted === true ? new ExecutionError("aborted", "aborted") : undefined;
  }

  #complete(exit: ChildExit): Effect.Effect<ExecResult> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#spill.finish();
      this.#emit(this.#decoders.stdout.decode(), "stdout");
      this.#emit(this.#decoders.stderr.decode(), "stderr");
      if (this.#callbackError !== undefined) return this.#settle(err(this.#callbackError));
      const interrupted = this.#interruption();
      const spillPath = this.#spill.path;
      if (interrupted !== undefined) {
        if (spillPath !== undefined) interrupted.spillPath = spillPath;
        return this.#settle(err(interrupted));
      }
      if (this.#spill.error !== undefined) return this.#settle(err(this.#spill.error));
      const exitCode = exitCodeOf(exit);
      return this.#settle(ok({ exitCode, ...(spillPath === undefined ? {} : { spillPath }) }));
    });
  }

  run(): Effect.Effect<ExecResult> {
    return Effect.gen({ self: this }, function* () {
      const child = this.#spawn();
      if (child instanceof ExecutionError) return this.#settle(err(child));
      this.#watch(child);
      return yield* waitForChildProcess(child, () => this.#spill.draining).pipe(
        Effect.matchEffect({
          onSuccess: (exit) => this.#complete(exit),
          onFailure: (error) =>
            Effect.succeed(
              this.#settle(err(new ExecutionError("spawn_error", error.message, error))),
            ),
        }),
      );
    });
  }
}
