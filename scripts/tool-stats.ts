import { homedir, tmpdir } from "node:os";

import { Console, Data, DateTime, Effect, Predicate, Result, Schema, Stream } from "effect";

import { openBrowser } from "../apps/coding-agent/src/utils/open-browser.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { jsonlFilesRecursive } from "./sessions.ts";
import { renderReport } from "./tool-stats-report.ts";
import type { HistogramRow } from "./tool-stats-report.ts";

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

class ToolStatsError extends Data.TaggedError("ToolStatsError")<{
  readonly message: string;
}> {}

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

const BUCKETS: ReadonlyArray<number> = [
  0,
  50,
  100,
  250,
  500,
  1000,
  2000,
  4000,
  8000,
  16_000,
  32_000,
  Number.POSITIVE_INFINITY,
];

const HELP = "Usage: scripts/tool-stats.ts [--sessions-dir <dir>] [--output <file.html>]";

const COMMAND_SEPARATOR = /\n|&&|\|\||;|\|/u;
const COMMAND_SHAPE = /^(?:\w+=\S+\s+)*(?:sudo\s+)?(\S+)(?:\s+(\S+))?/u;

const parseArgs = (host: HostShape) =>
  Effect.gen(function* () {
    let sessionsDir = host.join(homedir(), ".msa", "agent", "sessions");
    let output = host.join(tmpdir(), "msa-tool-stats.html");
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      const value = args[index + 1];
      if (arg === "--sessions-dir" && value !== undefined && value !== "") {
        sessionsDir = host.resolve(value);
        index += 1;
      } else if ((arg === "--output" || arg === "-o") && value !== undefined && value !== "") {
        output = host.resolve(value);
        index += 1;
      } else if (arg === "--help" || arg === "-h") {
        yield* Console.log(HELP);
        return yield* Effect.sync(() => process.exit(0));
      }
    }
    return { output, sessionsDir };
  });

const getStats = <T>(map: Map<string, T>, key: string, create: () => T): T => {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
};

const createToolStats = (): ToolStats => ({
  calls: 0,
  results: 0,
  estimatedTokens: 0,
  samples: [],
  errors: 0,
});

const createBashStats = (): BashCommandStats => ({ calls: 0, estimatedTokens: 0, samples: [] });

const estimateTokenCount = (text: string): number => Math.ceil(text.length / 4);

const blockText = (block: Block): string => {
  if (block.type === "text" && Predicate.isString(block.text)) return block.text;
  if (block.type === "image" && Predicate.isString(block.data)) return block.data;
  return JSON.stringify(block);
};

const contentText = (content: MessageContent | undefined): string => {
  if (Predicate.isString(content)) return content;
  if (content === undefined) return "";
  return content.map(blockText).join("\n");
};

const getBashCommand = (args: unknown): string | undefined => {
  if (!Predicate.isObject(args) || !("command" in args)) return undefined;
  const command: unknown = args.command;
  return Predicate.isString(command) ? command : undefined;
};

const commandKey = (command: string): string => {
  const first = command.split(COMMAND_SEPARATOR)[0]?.trim() ?? command.trim();
  const match = COMMAND_SHAPE.exec(first);
  if (match === null) return "unknown";
  const bin = match[1] ?? "unknown";
  const second = match[2];
  const sub = second !== undefined && second !== "" && !second.startsWith("-") ? ` ${second}` : "";
  return `${bin}${sub}`;
};

const bucketCounts = (samples: ReadonlyArray<number>): ReadonlyArray<number> => {
  const counts: Array<number> = Array.from({ length: BUCKETS.length - 1 }, () => 0);
  for (const sample of samples) {
    const index = BUCKETS.findIndex((max, position) => position > 0 && sample <= max) - 1;
    const bucket = Math.max(0, index);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
};

const bucketLabels = (): ReadonlyArray<string> =>
  BUCKETS.slice(0, -1).map((min, index) => {
    const max = BUCKETS[index + 1];
    return max !== undefined && Number.isFinite(max) ? `${min}-${max}` : `${min}+`;
  });

const recordToolCalls = (aggregate: Aggregate, content: ReadonlyArray<Block>): void => {
  for (const block of content) {
    if (
      block.type !== "toolCall" ||
      !Predicate.isString(block.name) ||
      !Predicate.isString(block.id)
    ) {
      continue;
    }
    getStats(aggregate.tools, block.name, createToolStats).calls += 1;
    const bashCommand = block.name === "bash" ? getBashCommand(block.arguments) : undefined;
    aggregate.callsById.set(block.id, { bashCommand, toolName: block.name });
    if (bashCommand !== undefined) {
      getStats(aggregate.bashCommands, commandKey(bashCommand), createBashStats).calls += 1;
    }
  }
};

const recordToolResult = (aggregate: Aggregate, message: NonNullable<Entry["message"]>): void => {
  const toolName = message.toolName;
  if (toolName === undefined || toolName === "") return;
  const tokens = estimateTokenCount(contentText(message.content));
  const stats = getStats(aggregate.tools, toolName, createToolStats);
  stats.results += 1;
  stats.estimatedTokens += tokens;
  stats.samples.push(tokens);
  if (message.isError === true) stats.errors += 1;
  const callId = message.toolCallId;
  const call = callId === undefined || callId === "" ? undefined : aggregate.callsById.get(callId);
  const bashCommand = call?.bashCommand;
  if (bashCommand !== undefined) {
    const bash = getStats(aggregate.bashCommands, commandKey(bashCommand), createBashStats);
    bash.estimatedTokens += tokens;
    bash.samples.push(tokens);
  }
};

const recordEntry = (aggregate: Aggregate, entry: Entry): void => {
  const message = entry.message;
  if (entry.type !== "message" || message === undefined) return;
  if (message.role === "assistant" && !Predicate.isString(message.content)) {
    if (message.content !== undefined) recordToolCalls(aggregate, message.content);
    return;
  }
  if (message.role === "toolResult") recordToolResult(aggregate, message);
};

const scan = (host: HostShape, files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const aggregate: Aggregate = {
      bashCommands: new Map<string, BashCommandStats>(),
      callsById: new Map<string, ToolCallInfo>(),
      parseErrors: 0,
      tools: new Map<string, ToolStats>(),
    };
    yield* Effect.forEach(files, (file) =>
      host.lines(file).pipe(
        Stream.filter((line) => line.trim() !== ""),
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            const parsed = yield* Effect.result(decodeEntry(line));
            if (Result.isSuccess(parsed)) {
              recordEntry(aggregate, parsed.success);
              return;
            }
            aggregate.parseErrors += 1;
          }),
        ),
      ),
    );
    return aggregate;
  });

const toolRowsOf = (tools: Map<string, ToolStats>): ReadonlyArray<HistogramRow> =>
  [...tools.entries()]
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      results: stats.results,
      estimatedTokens: stats.estimatedTokens,
      samples: stats.samples,
      errors: stats.errors,
      avg: stats.results > 0 ? stats.estimatedTokens / stats.results : 0,
      histogram: bucketCounts(stats.samples),
    }))
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens);

const bashRowsOf = (bashCommands: Map<string, BashCommandStats>): ReadonlyArray<HistogramRow> =>
  [...bashCommands.entries()]
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      estimatedTokens: stats.estimatedTokens,
      samples: stats.samples,
      avg: stats.samples.length > 0 ? stats.estimatedTokens / stats.samples.length : 0,
      histogram: bucketCounts(stats.samples),
    }))
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens)
    .slice(0, 50);

const program = Effect.gen(function* () {
  const host = yield* Host;
  const { output, sessionsDir } = yield* parseArgs(host);
  if (!(yield* host.exists(sessionsDir))) {
    return yield* new ToolStatsError({ message: `Sessions directory not found: ${sessionsDir}` });
  }
  const files = yield* jsonlFilesRecursive({ directory: sessionsDir, host });
  const aggregate = yield* scan(host, files);
  const html = yield* renderReport({
    bashCommands: bashRowsOf(aggregate.bashCommands),
    bucketLabels: bucketLabels(),
    files: files.length,
    generatedAt: DateTime.formatIso(yield* DateTime.now),
    parseErrors: aggregate.parseErrors,
    sessionsDir,
    tools: toolRowsOf(aggregate.tools),
  });
  yield* host.makeDirectory(host.resolve(output, ".."));
  yield* host.writeText(output, html);
  yield* Console.log(`Wrote ${output}`);
  yield* Effect.sync(() => openBrowser(output));
});

runScript(program);
