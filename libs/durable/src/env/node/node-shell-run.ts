import { Effect, Schema } from "effect";

import ExecutionError from "../execution-error.ts";
import resultModule from "../result.ts";
import StreamDecoder from "../stream-decoder.ts";
import type typesModule from "../types.ts";
import nodeChildWait from "./node-child-wait.ts";
import nodeProcess from "./node-process.ts";
import type nodeShellRunTypes from "./node-shell-run.types.ts";
import OutputSpill from "./node-spill.ts";
import nodeTimer from "./node-timer.ts";

const { killProcessTree, spawnProcessGroup } = nodeProcess;
const { err, ok, toError } = resultModule;

const { cancelTimer, startTimer } = nodeTimer;
const { exitCodeOf, waitForChildProcess } = nodeChildWait;

type ExecResult = nodeShellRunTypes.Result<
  typesModule.ShellExecResult,
  nodeShellRunTypes.ExecutionError
>;

export default class ShellRun {
  readonly #request: nodeShellRunTypes.ShellRunRequest;
  readonly #spill: nodeShellRunTypes.OutputSpill;
  readonly #decoders: Readonly<
    Record<typesModule.ShellOutputInfo["stream"], nodeShellRunTypes.StreamDecoder>
  > = {
    stderr: new StreamDecoder(),
    stdout: new StreamDecoder(),
  };
  #child: nodeShellRunTypes.OsProcess | undefined;
  #timer: nodeShellRunTypes.Timer | undefined;
  #callbackError: nodeShellRunTypes.ExecutionError | undefined;
  #settled = false;
  #timedOut = false;

  constructor(request: nodeShellRunTypes.ShellRunRequest) {
    this.#request = request;
    this.#spill = new OutputSpill({
      abort: this.#abort,
      createTempFile: request.createTempFile,
      pause: this.#pauseOutput,
      resume: this.#resumeOutput,
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
    this.#callbackError = ExecutionError.create("callback_error", cause.message, cause);
    this.#abort();
  }

  #emit(text: string, stream: typesModule.ShellOutputInfo["stream"]): void {
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

  #spawn(): nodeShellRunTypes.OsProcess | nodeShellRunTypes.ExecutionError {
    const request = this.#request;
    try {
      const child = spawnProcessGroup({
        args: request.args,
        cwd: request.cwd,
        env: request.env,
        pipeStdin: request.stdinCommand !== undefined,
        program: request.program,
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
      return ExecutionError.create("spawn_error", cause.message, cause);
    }
  }

  #watch(child: nodeShellRunTypes.OsProcess): void {
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

  #feed(source: typesModule.ShellOutputInfo["stream"]): (chunk: Uint8Array) => void {
    const decoder = this.#decoders[source];
    return (chunk) => {
      this.#emit(decoder.decode(chunk), source);
      this.#spill.feed(chunk, this.#request.spill);
    };
  }

  #interruption(): nodeShellRunTypes.ExecutionError | undefined {
    if (this.#timedOut) return ExecutionError.create("timeout", `timeout:${this.#request.timeout}`);
    return this.#signal?.aborted === true ? ExecutionError.create("aborted", "aborted") : undefined;
  }

  #complete(exit: nodeShellRunTypes.ChildExit): Effect.Effect<ExecResult> {
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
      if (Schema.is(ExecutionError)(child)) return this.#settle(err(child));
      this.#watch(child);
      return yield* waitForChildProcess(child, () => this.#spill.draining).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.succeed(
              this.#settle(err(ExecutionError.create("spawn_error", error.message, error))),
            ),
          onSuccess: (exit) => this.#complete(exit),
        }),
      );
    });
  }
}
