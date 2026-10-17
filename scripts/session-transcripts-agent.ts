import { styleText } from "node:util";

import { Console, Effect, Predicate, Ref, Result, Schema, Stream } from "effect";

import type { HostShape } from "./host.ts";

const MAX_DISPLAY_WIDTH = 100;

const EventSchema = Schema.Struct({
  type: Schema.String,
  assistantMessageEvent: Schema.optional(
    Schema.Struct({ type: Schema.String, delta: Schema.optional(Schema.String) }),
  ),
  toolName: Schema.optional(Schema.String),
  args: Schema.optional(
    Schema.Struct({
      path: Schema.optional(Schema.String),
      offset: Schema.optional(Schema.Finite),
      limit: Schema.optional(Schema.Finite),
      content: Schema.optional(Schema.String),
    }),
  ),
});

type AgentEvent = typeof EventSchema.Type;

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(EventSchema));

const truncateLine = (text: string, maxWidth: number): string => {
  const singleLine = text.replaceAll("\n", " ").replaceAll(/\s+/gu, " ").trim();
  return singleLine.length <= maxWidth ? singleLine : `${singleLine.slice(0, maxWidth - 3)}...`;
};

const flushText = (buffer: Ref.Ref<string>) =>
  Effect.gen(function* () {
    const text = yield* Ref.get(buffer);
    if (text.trim() === "") return;
    yield* Console.log(styleText("dim", `  ${truncateLine(text, MAX_DISPLAY_WIDTH)}`));
    yield* Ref.set(buffer, "");
  });

const describeArgs = (event: AgentEvent): string => {
  const args = event.args;
  if (args === undefined) return "";
  if (event.toolName === "read") {
    const parts = [args.path ?? ""];
    if (args.offset !== undefined && args.offset !== 0) parts.push(` offset=${args.offset}`);
    if (args.limit !== undefined && args.limit !== 0) parts.push(` limit=${args.limit}`);
    return parts.join("");
  }
  return event.toolName === "write" ? (args.path ?? "") : "";
};

const handleEvent = (event: AgentEvent, buffer: Ref.Ref<string>) =>
  Effect.gen(function* () {
    const delta = event.assistantMessageEvent?.delta;
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta" &&
      delta !== undefined &&
      delta !== ""
    ) {
      yield* Ref.update(buffer, (text) => text + delta);
      return;
    }
    const toolName = event.toolName;
    if (event.type === "tool_execution_start" && toolName !== undefined && toolName !== "") {
      yield* flushText(buffer);
      yield* Console.log(styleText("cyan", `  [${toolName}] ${describeArgs(event)}`));
      return;
    }
    if (event.type === "turn_end") {
      yield* flushText(buffer);
      yield* Ref.set(buffer, "");
    }
  });

const runSubagent = (options: {
  readonly cwd: string;
  readonly host: HostShape;
  readonly prompt: string;
}): Effect.Effect<boolean> =>
  Effect.scoped(
    Effect.gen(function* () {
      const buffer = yield* Ref.make("");
      const child = yield* options.host.spawn({
        args: ["--mode", "json", "--tools", "read,write", "-p", options.prompt],
        command: "msa",
        cwd: options.cwd,
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      });
      const readStdout = child.stdoutLines.pipe(
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            const parsed = yield* Effect.result(decodeEvent(line));
            if (Result.isSuccess(parsed)) yield* handleEvent(parsed.success, buffer);
          }),
        ),
      );
      const readStderr = child.stderrChunks.pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => process.stderr.write(styleText("red", chunk))),
        ),
      );
      const [, , exitCode] = yield* Effect.all([readStdout, readStderr, child.exitCode], {
        concurrency: "unbounded",
      });
      return exitCode === 0;
    }),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const failure: unknown = cause;
        const message =
          Predicate.isObject(failure) && "message" in failure && Predicate.isString(failure.message)
            ? failure.message
            : String(cause);
        yield* Console.error(styleText("red", `  Failed to spawn msa: ${message}`));
        return false;
      }),
    ),
  );

export { runSubagent };
