import { styleText } from "node:util";

import { Effect, Predicate, Ref, Result, Schema, Stream } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import type hostTypes from "./host.types.ts";

const MAX_DISPLAY_WIDTH = 100;

const EventSchema = Schema.Struct({
  args: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Finite),
      offset: Schema.optional(Schema.Finite),
      path: Schema.optional(Schema.String),
    }),
  ),
  assistantMessageEvent: Schema.optional(
    Schema.Struct({ delta: Schema.optional(Schema.String), type: Schema.String }),
  ),
  toolName: Schema.optional(Schema.String),
  type: Schema.String,
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
    yield* scriptOutput.print(styleText("dim", `  ${truncateLine(text, MAX_DISPLAY_WIDTH)}`));
    yield* Ref.set(buffer, "");
  });

type ToolArgs = NonNullable<AgentEvent["args"]>;

const nonZeroPart = (name: string, value: number | undefined): string =>
  value === undefined || value === 0 ? "" : ` ${name}=${value}`;

const ARG_DESCRIBERS: ReadonlyMap<string, (args: ToolArgs) => string> = new Map([
  [
    "read",
    (args: ToolArgs) =>
      `${args.path ?? ""}${nonZeroPart("offset", args.offset)}${nonZeroPart("limit", args.limit)}`,
  ],
  ["write", (args: ToolArgs) => args.path ?? ""],
]);

const describeArgs = (event: AgentEvent): string => {
  const describe = ARG_DESCRIBERS.get(event.toolName ?? "");
  return event.args === undefined || describe === undefined ? "" : describe(event.args);
};

const nonEmpty = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;

const isTextDelta = (event: AgentEvent): boolean =>
  event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta";

const textDeltaOf = (event: AgentEvent): string | undefined =>
  isTextDelta(event) ? nonEmpty(event.assistantMessageEvent?.delta) : undefined;

const startedToolOf = (event: AgentEvent): string | undefined =>
  event.type === "tool_execution_start" ? nonEmpty(event.toolName) : undefined;

const announceTool = (options: {
  readonly buffer: Ref.Ref<string>;
  readonly event: AgentEvent;
  readonly toolName: string;
}) =>
  Effect.andThen(
    flushText(options.buffer),
    scriptOutput.print(styleText("cyan", `  [${options.toolName}] ${describeArgs(options.event)}`)),
  );

const endTurn = (buffer: Ref.Ref<string>) => Effect.andThen(flushText(buffer), Ref.set(buffer, ""));

const handleEvent = (event: AgentEvent, buffer: Ref.Ref<string>): Effect.Effect<void> => {
  const delta = textDeltaOf(event);
  if (delta !== undefined) return Ref.update(buffer, (text) => text + delta);
  const toolName = startedToolOf(event);
  if (toolName !== undefined) return announceTool({ buffer, event, toolName });
  return event.type === "turn_end" ? endTurn(buffer) : Effect.void;
};

const runSubagent = (options: {
  readonly cwd: string;
  readonly host: hostTypes.HostShape;
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
          scriptOutput.printError(styleText("red", chunk.replace(/\n$/u, ""))),
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
          Predicate.isObject(failure) &&
          "message" in failure &&
          Predicate.isString(failure["message"])
            ? failure["message"]
            : String(cause);
        yield* scriptOutput.printError(styleText("red", `  Failed to spawn msa: ${message}`));
        return false;
      }),
    ),
  );

const sessionTranscriptsAgent = {
  runSubagent,
};

export default sessionTranscriptsAgent;
