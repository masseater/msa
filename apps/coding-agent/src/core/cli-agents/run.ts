import { createInterface } from "node:readline";

import type compatTypes from "@msa/ai/compat.types";
import { Effect, Option, Schema, Stream } from "effect";

import processEnv from "../../core/process-env.ts";
import childProcess from "../../utils/child-process.ts";
import type nodeChildProcessTypes from "../platform/node/child-process.types.ts";
import replyModule from "./reply.ts";
import type replyTypes from "./reply.types.ts";
import type runTypes from "./run.types.ts";

const { createReply } = replyModule;
const { spawnProcess, waitForChildProcess } = childProcess;
const { envSnapshot } = processEnv;

const SPAWN_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const KILL_GRACE_MS = 3000;

interface Attempt<Event> {
  readonly backend: runTypes.CliBackend<Event>;
  readonly model: compatTypes.Model<string>;
  readonly context: compatTypes.TranscriptContext;
  readonly options: compatTypes.SimpleStreamOptions | undefined;
  readonly cwd: string;
  readonly sink: runTypes.EventSink;
  readonly state: { aborted: boolean; failed: boolean; reportedFailure: string };
}

interface AttemptResult {
  readonly ok: boolean;
  readonly detail: string;
}

const decodeJsonLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const ignoreFailure = (run: () => unknown) =>
  Effect.ignore(Effect.tryPromise(() => Promise.resolve(run())));

const prepareCommand = <Event>(attempt: Attempt<Event>) =>
  Effect.gen(function* () {
    const { backend, cwd, model, options } = attempt;
    let command = backend.command(model, attempt.context, cwd);
    const payload = {
      args: command.args,
      cwd,
      model: model.id,
      prompt: command.stdin,
      provider: backend.providerId,
    };
    const replaced = yield* Effect.tryPromise(() =>
      Promise.resolve(options?.onPayload?.(payload, model)),
    ).pipe(Effect.orElseSucceed(() => undefined));
    const prompt = (replaced as { prompt?: unknown } | undefined)?.prompt;
    if (typeof prompt === "string") command = { ...command, stdin: prompt };
    return command;
  });

const readEvents = <Event>(attempt: Attempt<Event>, child: nodeChildProcessTypes.ChildProcess) => {
  const lines = createInterface({ input: child.stdout! });
  return Stream.fromAsyncIterable(lines, (cause) => cause).pipe(
    Stream.takeWhile(() => !attempt.state.aborted),
    Stream.runForEach((line) =>
      Effect.gen(function* () {
        const decoded = decodeJsonLine(line);
        if (Option.isNone(decoded)) return;
        const event = decoded.value as Event;
        yield* ignoreFailure(() => attempt.options?.onProviderStreamEvent?.(event, attempt.model));
        attempt.backend.handleEvent(event, attempt.sink);
      }),
    ),
    Effect.ignore,
    Effect.ensuring(Effect.sync(() => lines.close())),
  );
};

const awaitExit = (
  finished: Promise<number | null>,
  child: nodeChildProcessTypes.ChildProcess,
  aborted: boolean,
) =>
  Effect.gen(function* () {
    if (!aborted) return yield* Effect.promise(() => finished);
    child.kill("SIGTERM");
    const exited = yield* Effect.promise(() => finished).pipe(Effect.timeoutOption(KILL_GRACE_MS));
    if (Option.isSome(exited)) return exited.value;
    child.kill("SIGKILL");
    return yield* Effect.promise(() => finished);
  });

const superviseChild = <Event>(
  attempt: Attempt<Event>,
  command: runTypes.CliCommand,
  child: nodeChildProcessTypes.ChildProcess,
) =>
  Effect.gen(function* () {
    const { state } = attempt;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-8000);
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(command.stdin);
    let spawnError = "";
    const finished = waitForChildProcess(child).catch((error: unknown) => {
      spawnError = String(error);
      return -1;
    });
    yield* readEvents(attempt, child);
    const exitCode = yield* awaitExit(finished, child, state.aborted);
    if (state.aborted) return { detail: "aborted", ok: false };
    if (spawnError !== "") return { detail: spawnError, ok: false };
    if (exitCode === 0 && !state.failed) return { detail: "", ok: true };
    const tail = stderr.trim().slice(-2000);
    const fallback = tail === "" ? `${command.bin} exited with code ${exitCode}` : tail;
    return { detail: state.reportedFailure === "" ? fallback : state.reportedFailure, ok: false };
  });

const runAttempt = <Event>(attempt: Attempt<Event>): Effect.Effect<AttemptResult> =>
  Effect.gen(function* () {
    attempt.state.failed = false;
    attempt.state.reportedFailure = "";
    const command = yield* prepareCommand(attempt);
    return yield* Effect.try({
      catch: (error) => String(error),
      try: () =>
        spawnProcess(command.bin, command.args, {
          cwd: attempt.cwd,
          env: command.env ?? envSnapshot(),
          stdio: ["pipe", "pipe", "pipe"],
        }),
    }).pipe(
      Effect.matchEffect({
        onFailure: (detail) => Effect.succeed({ detail, ok: false }),
        onSuccess: (child) => superviseChild(attempt, command, child),
      }),
    );
  });

const runAttempts = <Event>(attempt: Attempt<Event>, reply: replyTypes.ReplyBuilder) =>
  Effect.gen(function* () {
    let failure = "";
    for (let index = 1; index <= SPAWN_ATTEMPTS && !attempt.state.aborted; index += 1) {
      const result = yield* runAttempt(attempt);
      if (result.ok) return { failure: "", ok: true };
      failure = result.detail;
      if (attempt.state.aborted || reply.hasContent || !attempt.backend.shouldRetry(failure)) break;
      yield* Effect.sleep(RETRY_DELAY_MS);
    }
    return { failure, ok: false };
  });

function streamViaCli<Event>(
  backend: runTypes.CliBackend<Event>,
  model: compatTypes.Model<string>,
  context: compatTypes.TranscriptContext,
  options?: compatTypes.SimpleStreamOptions,
): replyTypes.ReplyBuilder["stream"] {
  const reply = createReply(model);
  const state = { aborted: options?.signal?.aborted === true, failed: false, reportedFailure: "" };
  const sink: runTypes.EventSink = {
    addUsage: reply.addUsage,
    appendText: reply.appendText,
    appendThinking: reply.appendThinking,
    fail(failure) {
      state.failed = true;
      state.reportedFailure = failure;
    },
    setText: reply.setText,
  };
  const onAbort = () => {
    state.aborted = true;
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  const attempt: Attempt<Event> = {
    backend,
    context,
    cwd: process.cwd(),
    model,
    options,
    sink,
    state,
  };
  Effect.runFork(
    runAttempts(attempt, reply).pipe(
      Effect.tap(({ failure, ok }) =>
        Effect.sync(() => {
          options?.signal?.removeEventListener("abort", onAbort);
          if (state.aborted) reply.fail("aborted", "aborted");
          else if (ok) reply.done("stop");
          else reply.fail("error", failure === "" ? `${backend.providerId} failed` : failure);
        }),
      ),
    ),
  );
  return reply.stream;
}

const run = {
  streamViaCli,
};

export default run;
