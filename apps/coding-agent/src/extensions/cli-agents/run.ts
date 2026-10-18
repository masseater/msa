import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import type { Model, SimpleStreamOptions, TranscriptContext } from "@msa/ai/compat";
import * as Effect from "effect/Effect";

import { awaited, awaiting, performed } from "../../core/awaiting.ts";
import { schedule } from "../../core/platform.ts";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import { createReply, type ReplyBuilder } from "./reply.ts";

const SPAWN_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_500;
const KILL_GRACE_MS = 3_000;

export interface CliCommand {
  bin: string;
  args: string[];
  stdin: string;
  env?: NodeJS.ProcessEnv;
}

export type EventSink = Pick<
  ReplyBuilder,
  "setText" | "appendText" | "appendThinking" | "addUsage"
> & {
  fail(message: string): void;
};

export interface CliBackend<Event> {
  providerId: string;
  command(model: Model<string>, context: TranscriptContext, cwd: string): CliCommand;

  handleEvent(event: Event, sink: EventSink): void;

  shouldRetry(detail: string): boolean;
}

export function streamViaCli<Event>(
  backend: CliBackend<Event>,
  model: Model<string>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): ReplyBuilder["stream"] {
  const reply = createReply(model);
  const cwd = process.cwd();
  let failed = false;
  let reportedFailure = "";
  const sink: EventSink = {
    setText: reply.setText,
    appendText: reply.appendText,
    appendThinking: reply.appendThinking,
    addUsage: reply.addUsage,
    fail(failure) {
      failed = true;
      reportedFailure = failure;
    },
  };

  void (() =>
    Effect.runPromise(
      awaiting(function* () {
        let aborted = options?.signal?.aborted === true;
        const onAbort = () => {
          aborted = true;
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });

        const runAttempt = () =>
          Effect.runPromise(
            awaiting(function* () {
              failed = false;
              reportedFailure = "";
              let command = backend.command(model, context, cwd);
              try {
                const replaced = yield* awaited(
                  options?.onPayload?.(
                    {
                      provider: backend.providerId,
                      model: model.id,
                      cwd,
                      args: command.args,
                      prompt: command.stdin,
                    },
                    model,
                  ),
                );
                const prompt = (replaced as { prompt?: unknown } | undefined)?.prompt;
                if (typeof prompt === "string") command = { ...command, stdin: prompt };
              } catch {}

              let child: ChildProcess;
              try {
                child = spawnProcess(command.bin, command.args, {
                  cwd,
                  env: command.env ?? process.env,
                  stdio: ["pipe", "pipe", "pipe"],
                });
              } catch (error) {
                return { ok: false, detail: String(error) };
              }

              let stderr = "";
              child.stderr?.on("data", (chunk: Buffer) => {
                stderr = (stderr + String(chunk)).slice(-8_000);
              });
              child.stdin?.on("error", () => {});
              child.stdin?.end(command.stdin);

              let exitCode: number | null = null;
              let spawnError = "";
              const finished = waitForChildProcess(child).then(
                (code) => {
                  exitCode = code;
                  return undefined;
                },
                (error: unknown) => {
                  spawnError = String(error);
                  exitCode = -1;
                  return undefined;
                },
              );

              const lines = createInterface({ input: child.stdout! });
              const iterator = lines[Symbol.asyncIterator]();
              try {
                while (true) {
                  const step = yield* awaited(iterator.next());
                  if (step.done === true) break;
                  const line = step.value;
                  if (aborted) break;
                  let event: Event;
                  try {
                    event = JSON.parse(line) as Event;
                  } catch {
                    continue;
                  }
                  try {
                    yield* awaited(options?.onProviderStreamEvent?.(event, model));
                  } catch {}
                  backend.handleEvent(event, sink);
                }
              } finally {
                lines.close();
              }

              let killTimer: ReturnType<typeof schedule> | undefined;
              if (aborted) {
                child.kill("SIGTERM");
                killTimer = schedule(() => child.kill("SIGKILL"), KILL_GRACE_MS);
              }
              yield* awaited(finished);
              killTimer?.cancel();
              if (aborted) return { ok: false, detail: "aborted" };
              if (spawnError !== "") return { ok: false, detail: spawnError };
              if (exitCode === 0 && !failed) return { ok: true, detail: "" };
              return {
                ok: false,
                detail:
                  reportedFailure ||
                  stderr.trim().slice(-2_000) ||
                  `${command.bin} exited with code ${exitCode}`,
              };
            }),
          );

        let ok = false;
        let failure = "";
        for (let attempt = 1; attempt <= SPAWN_ATTEMPTS; attempt += 1) {
          if (aborted) break;
          const result = yield* awaited(runAttempt());
          if (result.ok) {
            ok = true;
            break;
          }
          failure = result.detail;
          if (aborted || reply.hasContent || !backend.shouldRetry(failure)) break;
          yield* performed(Effect.sleep(RETRY_DELAY_MS));
        }

        options?.signal?.removeEventListener("abort", onAbort);
        if (aborted) reply.fail("aborted", "aborted");
        else if (ok) {
          reply.done("stop");
        } else {
          reply.fail("error", failure || `${backend.providerId} failed`);
        }
      }),
    ))();

  return reply.stream;
}
