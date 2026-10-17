import type { Context } from "@msa/chord";
import {
  err,
  ExecutionError,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputInfo,
  type ShellOutputSkip,
} from "@msa/durable/env";
import { Cause, Effect, Exit } from "effect";

import { type Connection, type Json, RemoteError } from "./connection.ts";
import { type RemoteTarget, resolveIn, run } from "./file-op.ts";
import { errorMessage } from "./remote-error.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

type ExecResult = Result<ShellExecResult, ExecutionError>;

interface ExecRequest {
  readonly connection: Connection;
  readonly command: string | readonly string[];
  readonly options: ShellExecOptions | undefined;
  readonly context: Context;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly inheritEnv: boolean;
  readonly shellPath: string | undefined;
  readonly running: Map<number, number>;
}

function invalidTimeout(timeout: number | undefined): ExecResult | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return err(
      new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"),
    );
  }
  if (timeout * 1000 > MAX_TIMEOUT_MS) {
    return err(
      new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`),
    );
  }
  return undefined;
}

function failureOf(error: unknown, timeout: number | undefined): ExecutionError {
  if (!(error instanceof RemoteError)) return new ExecutionError("unknown", errorMessage(error));
  const failure =
    error.code === "timeout"
      ? new ExecutionError("timeout", `timeout:${timeout}`)
      : error.code === "aborted"
        ? new ExecutionError("aborted", "aborted")
        : error.code === "shell_unavailable" || error.code === "spawn_error"
          ? new ExecutionError(error.code, error.message)
          : new ExecutionError("unknown", error.message);
  const spillPath = error.fields["spillPath"];
  if (typeof spillPath === "string") failure.spillPath = spillPath;
  return failure;
}

function execFields(request: ExecRequest): Json {
  const { command, options } = request;
  const timeout = options?.timeout;
  return {
    ...(typeof command === "string" ? { command } : { argv: [...command] }),
    cwd: request.cwd,
    env: request.env,
    inheritEnv: request.inheritEnv,
    ...(request.shellPath === undefined ? {} : { shellPath: request.shellPath }),
    ...(timeout === undefined ? {} : { timeoutMs: timeout * 1000 }),
    ...(options?.spill === undefined ? {} : { spill: options.spill }),
    ...(options?.window === undefined ? {} : { window: options.window }),
  };
}

interface ExecState {
  callbackError: ExecutionError | undefined;
  settled: boolean;
  running: number | undefined;
}

function deliverOutput(
  request: ExecRequest,
  state: ExecState,
  controller: AbortController,
  event: Json,
  payload: Uint8Array,
): void {
  if (state.settled || state.callbackError !== undefined || event["kind"] !== "output") return;
  const text = Buffer.from(payload.buffer, payload.byteOffset, payload.length).toString("utf8");
  const onOutput = request.options?.onOutput;
  if (text === "" || onOutput === undefined) return;
  const info: ShellOutputInfo = { stream: event["stream"] === "stderr" ? "stderr" : "stdout" };
  if (event["skipped"] !== undefined) info.skipped = event["skipped"] as ShellOutputSkip;
  try {
    onOutput(text, request.context, info);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    state.callbackError = new ExecutionError("callback_error", cause.message, cause);
    controller.abort();
  }
}

function runExec(request: ExecRequest): Promise<ExecResult> {
  const signal = request.context.abortSignal;
  const state: ExecState = { callbackError: undefined, settled: false, running: undefined };
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const reply = request.connection.request("exec", execFields(request), {
    signal: controller.signal,
    onStart: (requestId, session) => {
      state.running = requestId;
      request.running.set(requestId, session);
    },
    onEvent: (event, payload) => {
      deliverOutput(request, state, controller, event, payload);
    },
  });
  return Effect.runPromise(
    Effect.exit(Effect.promise(() => reply)).pipe(
      Effect.map((exit): ExecResult => {
        if (state.callbackError !== undefined) return err(state.callbackError);
        if (Exit.isFailure(exit)) {
          return err(failureOf(Cause.squash(exit.cause), request.options?.timeout));
        }
        const { json } = exit.value;
        const spillPath = json["spillPath"];
        return ok({
          exitCode: json["exitCode"] as number,
          ...(typeof spillPath === "string" ? { spillPath } : {}),
        });
      }),
      Effect.ensuring(
        Effect.sync(() => {
          state.settled = true;
          signal?.removeEventListener("abort", onAbort);
          if (state.running !== undefined) request.running.delete(state.running);
        }),
      ),
    ),
  );
}

export interface ExecIn {
  readonly target: RemoteTarget;
  readonly command: string | readonly string[];
  readonly options: ShellExecOptions | undefined;
  readonly context: Context;
  readonly shellEnv: Record<string, string> | undefined;
  readonly shellPath: string | undefined;
  readonly running: Map<number, number>;
}

function execEnv(request: ExecIn, inheritEnv: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  const { options } = request;
  for (const [key, value] of Object.entries(
    inheritEnv ? { ...request.shellEnv, ...options?.env } : { ...options?.env },
  )) {
    if (value !== undefined) env[key.toWellFormed()] = value;
  }
  return env;
}

export function execIn(request: ExecIn): Promise<ExecResult> {
  const { target, options, context } = request;
  const signal = context.abortSignal;
  if (signal?.aborted === true)
    return Promise.resolve(err(new ExecutionError("aborted", "aborted")));
  const invalid = invalidTimeout(options?.timeout);
  if (invalid !== undefined) return Promise.resolve(invalid);
  const inheritEnv = options?.inheritEnv ?? true;
  const cwdOption = options?.cwd;
  const cwd =
    cwdOption === undefined || cwdOption === ""
      ? Promise.resolve(target.cwd)
      : run(resolveIn({ target, path: cwdOption }));
  return cwd.then(
    (resolvedCwd) => {
      if (signal?.aborted === true) return err(new ExecutionError("aborted", "aborted"));
      return runExec({
        connection: target.connection,
        command: request.command,
        options,
        context,
        cwd: resolvedCwd,
        env: execEnv(request, inheritEnv),
        inheritEnv,
        shellPath: request.shellPath,
        running: request.running,
      });
    },
    (error: unknown) => err(new ExecutionError("unknown", errorMessage(error))),
  );
}
