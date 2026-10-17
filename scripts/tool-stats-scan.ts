import { Effect, Predicate, Schema } from "effect";

import type { HostShape } from "./host.ts";
import { getOrCreate } from "./maps.ts";
import { forEachDecodedLine, messageOf } from "./sessions.ts";

interface ToolStats {
  calls: number;
  results: number;
  estimatedTokens: number;
  samples: Array<number>;
  errors: number;
}

interface BashCommandStats {
  calls: number;
  estimatedTokens: number;
  samples: Array<number>;
}

interface ToolCallInfo {
  readonly bashCommand: string | undefined;
  readonly toolName: string;
}

interface Aggregate {
  readonly bashCommands: Map<string, BashCommandStats>;
  readonly callsById: Map<string, ToolCallInfo>;
  parseErrors: number;
  readonly tools: Map<string, ToolStats>;
}

const ContentBlock = Schema.Record(Schema.String, Schema.Unknown);

const EntrySchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      role: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(ContentBlock)])),
      toolCallId: Schema.optional(Schema.String),
      toolName: Schema.optional(Schema.String),
      isError: Schema.optional(Schema.Boolean),
    }),
  ),
});

type Entry = typeof EntrySchema.Type;
type Block = typeof ContentBlock.Type;
type MessageContent = NonNullable<NonNullable<Entry["message"]>["content"]>;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(EntrySchema));

const COMMAND_SEPARATOR = /\n|&&|\|\||;|\|/u;
const COMMAND_SHAPE = /^(?:\w+=\S+\s+)*(?:sudo\s+)?(\S+)(?:\s+(\S+))?/u;

const createToolStats = (): ToolStats => ({
  calls: 0,
  results: 0,
  estimatedTokens: 0,
  samples: [],
  errors: 0,
});

const createBashStats = (): BashCommandStats => ({ calls: 0, estimatedTokens: 0, samples: [] });

const estimateTokenCount = (text: string): number => Math.ceil(text.length / 4);

const BLOCK_TEXT_FIELDS: ReadonlyMap<unknown, string> = new Map([
  ["text", "text"],
  ["image", "data"],
]);

const blockText = (block: Block): string => {
  const field = BLOCK_TEXT_FIELDS.get(block["type"]);
  const text = field === undefined ? undefined : block[field];
  return Predicate.isString(text) ? text : JSON.stringify(block);
};

const contentText = (content: MessageContent | undefined): string => {
  if (Predicate.isString(content)) return content;
  if (content === undefined) return "";
  return content.map(blockText).join("\n");
};

const getBashCommand = (args: unknown): string | undefined => {
  if (!Predicate.isObject(args) || !("command" in args)) return undefined;
  const command: unknown = args["command"];
  return Predicate.isString(command) ? command : undefined;
};

const firstCommand = (command: string): string =>
  command.split(COMMAND_SEPARATOR)[0]?.trim() ?? command.trim();

const subcommandSuffix = (second: string | undefined): string =>
  second !== undefined && second !== "" && !second.startsWith("-") ? ` ${second}` : "";

const commandKey = (command: string): string => {
  const match = COMMAND_SHAPE.exec(firstCommand(command));
  if (match === null) return "unknown";
  return `${match[1] ?? "unknown"}${subcommandSuffix(match[2])}`;
};

const recordToolCall = (aggregate: Aggregate, call: ToolCallInfo & { readonly id: string }) => {
  getOrCreate(aggregate.tools, call.toolName, createToolStats).calls += 1;
  aggregate.callsById.set(call.id, { bashCommand: call.bashCommand, toolName: call.toolName });
  if (call.bashCommand !== undefined) {
    getOrCreate(aggregate.bashCommands, commandKey(call.bashCommand), createBashStats).calls += 1;
  }
};

const bashCommandOf = (toolName: string, args: unknown): string | undefined =>
  toolName === "bash" ? getBashCommand(args) : undefined;

const toolCallOf = (block: Block): (ToolCallInfo & { readonly id: string }) | undefined =>
  block["type"] === "toolCall" &&
  Predicate.isString(block["name"]) &&
  Predicate.isString(block["id"])
    ? {
        bashCommand: bashCommandOf(block["name"], block["arguments"]),
        id: block["id"],
        toolName: block["name"],
      }
    : undefined;

const recordToolCalls = (aggregate: Aggregate, content: ReadonlyArray<Block>): void => {
  for (const call of content.map(toolCallOf)) {
    if (call !== undefined) recordToolCall(aggregate, call);
  }
};

const addResult = (stats: ToolStats, tokens: number, isError: boolean): void => {
  stats.results += 1;
  stats.estimatedTokens += tokens;
  stats.samples.push(tokens);
  if (isError) stats.errors += 1;
};

const callBashCommand = (aggregate: Aggregate, callId: string | undefined): string | undefined =>
  callId === undefined || callId === "" ? undefined : aggregate.callsById.get(callId)?.bashCommand;

const addBashResult = (aggregate: Aggregate, callId: string | undefined, tokens: number): void => {
  const bashCommand = callBashCommand(aggregate, callId);
  if (bashCommand === undefined) return;
  const bash = getOrCreate(aggregate.bashCommands, commandKey(bashCommand), createBashStats);
  bash.estimatedTokens += tokens;
  bash.samples.push(tokens);
};

const recordToolResult = (aggregate: Aggregate, message: NonNullable<Entry["message"]>): void => {
  const toolName = message.toolName;
  if (toolName === undefined || toolName === "") return;
  const tokens = estimateTokenCount(contentText(message.content));
  addResult(
    getOrCreate(aggregate.tools, toolName, createToolStats),
    tokens,
    message.isError === true,
  );
  addBashResult(aggregate, message.toolCallId, tokens);
};

const contentBlocks = (content: MessageContent | undefined): ReadonlyArray<Block> =>
  Predicate.isString(content) ? [] : (content ?? []);

const recordMessage = (aggregate: Aggregate, message: NonNullable<Entry["message"]>): void => {
  if (message.role === "assistant") recordToolCalls(aggregate, contentBlocks(message.content));
  else if (message.role === "toolResult") recordToolResult(aggregate, message);
};

const recordEntry = (aggregate: Aggregate, entry: Entry): void => {
  const message = messageOf(entry);
  if (message !== undefined) recordMessage(aggregate, message);
};

const scanToolUsage = ({
  files,
  host,
}: {
  readonly files: ReadonlyArray<string>;
  readonly host: HostShape;
}) =>
  Effect.gen(function* () {
    const aggregate: Aggregate = {
      bashCommands: new Map<string, BashCommandStats>(),
      callsById: new Map<string, ToolCallInfo>(),
      parseErrors: 0,
      tools: new Map<string, ToolStats>(),
    };
    yield* Effect.forEach(files, (file) =>
      forEachDecodedLine({
        decode: decodeEntry,
        file,
        host,
        onEntry: (entry) => recordEntry(aggregate, entry),
        onMalformed: () => {
          aggregate.parseErrors += 1;
        },
      }),
    );
    return aggregate;
  });

export type { BashCommandStats, ToolStats };
export { scanToolUsage };
