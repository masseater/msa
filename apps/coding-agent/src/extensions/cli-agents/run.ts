import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import type { Model, SimpleStreamOptions, TranscriptContext } from "@msa/ai/compat";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  void (async () => {
    let aborted = options?.signal?.aborted === true;
    const onAbort = () => {
      aborted = true;
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    const runAttempt = async () => {
      failed = false;
      reportedFailure = "";
      let command = backend.command(model, context, cwd);
      try {
        const replaced = await options?.onPayload?.(
          {
            provider: backend.providerId,
            model: model.id,
            cwd,
            args: command.args,
            prompt: command.stdin,
          },
          model,
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
        },
        (error: unknown) => {
          spawnError = String(error);
          exitCode = -1;
        },
      );

      const lines = createInterface({ input: child.stdout! });
      try {
        for await (const line of lines) {
          if (aborted) break;
          let event: Event;
          try {
            event = JSON.parse(line) as Event;
          } catch {
            continue;
          }
          try {
            await options?.onProviderStreamEvent?.(event, model);
          } catch {}
          backend.handleEvent(event, sink);
        }
      } finally {
        lines.close();
      }

      if (aborted) {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref?.();
      }
      await finished;
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
    };

    let ok = false;
    let failure = "";
    for (let attempt = 1; attempt <= SPAWN_ATTEMPTS && !aborted; attempt += 1) {
      const result = await runAttempt();
      if (result.ok) {
        ok = true;
        break;
      }
      failure = result.detail;
      if (aborted || reply.hasContent || !backend.shouldRetry(failure)) break;
      await sleep(RETRY_DELAY_MS);
    }

    options?.signal?.removeEventListener("abort", onAbort);
    if (aborted) reply.fail("aborted", "aborted");
    else if (ok) {
      reply.done("stop");
    } else {
      reply.fail("error", failure || `${backend.providerId} failed`);
    }
  })();

  return reply.stream;
}
