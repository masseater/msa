import type { Context } from "@msa/chord";
import envModule from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Cause, Effect, Exit } from "effect";

import connectionModule from "./connection.ts";
import type connectionTypes from "./connection.types.ts";
import type execTypes from "./exec.types.ts";
import fileOp from "./file-op.ts";
import remoteError from "./remote-error.ts";

const { ExecutionError, err, ok } = envModule;

const { RemoteError } = connectionModule;
const { errorMessage } = remoteError;
const { resolveIn, run } = fileOp;

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

type ExecResult = envTypes.Result<envTypes.ShellExecResult, envTypes.ExecutionError>;

interface ExecRequest {
  readonly connection: connectionTypes.Connection;
  readonly command: string | readonly string[];
  readonly options: envTypes.ShellExecOptions | undefined;
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

function failureOf(error: unknown, timeout: number | undefined): envTypes.ExecutionError {
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

function execFields(request: ExecRequest): connectionTypes.Json {
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
  callbackError: envTypes.ExecutionError | undefined;
  settled: boolean;
  running: number | undefined;
}

function deliverOutput(
  request: ExecRequest,
  state: ExecState,
  controller: AbortController,
  event: connectionTypes.Json,
  payload: Uint8Array,
): void {
  if (state.settled || state.callbackError !== undefined || event["kind"] !== "output") return;
  const text = Buffer.from(payload.buffer, payload.byteOffset, payload.length).toString("utf8");
  const onOutput = request.options?.onOutput;
  if (text === "" || onOutput === undefined) return;
  const info: envTypes.ShellOutputInfo = {
    stream: event["stream"] === "stderr" ? "stderr" : "stdout",
  };
  if (event["skipped"] !== undefined) info.skipped = event["skipped"] as envTypes.ShellOutputSkip;
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
  const state: ExecState = { callbackError: undefined, running: undefined, settled: false };
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const reply = request.connection.request("exec", execFields(request), {
    onEvent: (event, payload) => {
      deliverOutput(request, state, controller, event, payload);
    },
    onStart: (requestId, session) => {
      state.running = requestId;
      request.running.set(requestId, session);
    },
    signal: controller.signal,
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

function execEnv(request: execTypes.ExecIn, inheritEnv: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  const { options } = request;
  for (const [key, value] of Object.entries(
    inheritEnv ? { ...request.shellEnv, ...options?.env } : { ...options?.env },
  )) {
    if (value !== undefined) env[key.toWellFormed()] = value;
  }
  return env;
}

function execIn(request: execTypes.ExecIn): Promise<ExecResult> {
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
      : run(resolveIn({ path: cwdOption, target }));
  return cwd.then(
    (resolvedCwd) => {
      if (signal?.aborted === true) return err(new ExecutionError("aborted", "aborted"));
      return runExec({
        command: request.command,
        connection: target.connection,
        context,
        cwd: resolvedCwd,
        env: execEnv(request, inheritEnv),
        inheritEnv,
        options,
        running: request.running,
        shellPath: request.shellPath,
      });
    },
    (error: unknown) => err(new ExecutionError("unknown", errorMessage(error))),
  );
}

const exec = {
  execIn,
};

export default exec;
