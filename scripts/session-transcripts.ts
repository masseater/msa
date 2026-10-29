import { homedir } from "node:os";
import { styleText } from "node:util";

import { Effect, Predicate } from "effect";

import type sessionManagerTypes from "../apps/coding-agent/src/core/session-manager.types.ts";
import sessionFormat from "../apps/coding-agent/src/core/session-manager/session-format.ts";
import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import hostModule from "./host.ts";
import type hostTypes from "./host.types.ts";
import sessionTranscriptsAgent from "./session-transcripts-agent.ts";
import sessionTranscriptsPrompts from "./session-transcripts-prompts.ts";

const { Host, runScript } = hostModule;
const { runSubagent } = sessionTranscriptsAgent;
const { aggregationPrompt, analysisPrompt } = sessionTranscriptsPrompts;

const { parseSessionEntries } = sessionFormat;

const MAX_CHARS_PER_FILE = 100_000;

interface Args {
  readonly analyze: boolean;
  readonly cwd: string;
  readonly outputDir: string;
}

const cwdToSessionDir = (host: hostTypes.HostShape, cwd: string): string =>
  `--${host.resolve(cwd).replaceAll("/", "-").slice(1)}--`;

const isTextBlock = (block: unknown): boolean =>
  Predicate.hasProperty("type")(block) && block.type === "text";

const blockText = (block: unknown): unknown =>
  Predicate.hasProperty("text")(block) ? block.text : undefined;

const nonEmptyTextOf = (block: unknown): ReadonlyArray<string> => {
  const text = blockText(block);
  return isTextBlock(block) && Predicate.isString(text) && text !== "" ? [text] : [];
};

const extractTextContent = (content: unknown): string => {
  if (Predicate.isString(content)) return content;
  return Array.isArray(content) ? content.flatMap(nonEmptyTextOf).join("\n") : "";
};

const isConversationRole = (role: string | undefined): role is "assistant" | "user" =>
  role === "user" || role === "assistant";

const transcriptMessage = (entry: sessionManagerTypes.FileEntry): ReadonlyArray<string> => {
  if (entry.type !== "message") return [];
  const { role, content } = (entry as sessionManagerTypes.SessionMessageEntry).message as {
    role?: string;
    content?: unknown;
  };
  if (!isConversationRole(role)) return [];
  const text = extractTextContent(content);
  return text.trim() === "" ? [] : [`[${role.toUpperCase()}]\n${text}`];
};

const parseSession = (host: hostTypes.HostShape, filePath: string) =>
  Effect.map(host.readText(filePath), (text) =>
    parseSessionEntries(text).flatMap(transcriptMessage),
  );

const optionIndices = (args: ReadonlyArray<string>, outputIndex: number): ReadonlySet<number> => {
  const analyzeIndex = args.indexOf("--analyze");
  return new Set(
    outputIndex === -1 ? [analyzeIndex] : [analyzeIndex, outputIndex, outputIndex + 1],
  );
};

const positionalCwd = (args: ReadonlyArray<string>, outputIndex: number): string | undefined => {
  const options = optionIndices(args, outputIndex);
  return args.find((arg, index) => !options.has(index) && !arg.startsWith("--") && arg !== "");
};

const outputDirOf = (host: hostTypes.HostShape, value: string | undefined): string =>
  value === undefined || value === "" ? host.resolve("./session-transcripts") : host.resolve(value);

const parseArgs = (host: hostTypes.HostShape): Args => {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  return {
    analyze: args.includes("--analyze"),
    cwd: host.resolve(positionalCwd(args, outputIndex) ?? process.cwd()),
    outputDir: outputDirOf(host, outputIndex === -1 ? undefined : args[outputIndex + 1]),
  };
};

const transcriptFileName = (index: number): string =>
  `session-transcripts-${String(index).padStart(3, "0")}.txt`;

const collectTranscripts = (host: hostTypes.HostShape, sessionDir: string) =>
  Effect.gen(function* () {
    const names = yield* host.readDirectory(sessionDir);
    const sessionFiles = [...names.filter((name) => name.endsWith(".jsonl"))].sort();
    yield* scriptOutput.print(`Found ${sessionFiles.length} session files in ${sessionDir}`);
    const transcripts = yield* Effect.forEach(sessionFiles, (file) =>
      Effect.gen(function* () {
        const messages = yield* parseSession(host, host.join(sessionDir, file));
        return messages.length > 0
          ? [`=== SESSION: ${file} ===\n${messages.join("\n---\n")}\n=== END SESSION ===`]
          : [];
      }),
    );
    return transcripts.flat();
  });

interface TranscriptChunk {
  readonly content: string;
  readonly oversized: boolean;
}

const appendTranscript = (current: string, transcript: string): string =>
  current === "" ? transcript : `${current}\n\n${transcript}`;

const chunkTranscripts = (transcripts: ReadonlyArray<string>): ReadonlyArray<TranscriptChunk> => {
  const chunks: Array<TranscriptChunk> = [];
  let current = "";
  const closeCurrent = (): void => {
    if (current.length > 0) chunks.push({ content: current, oversized: false });
    current = "";
  };
  for (const transcript of transcripts) {
    if (current.length + transcript.length + 2 > MAX_CHARS_PER_FILE) closeCurrent();
    if (transcript.length > MAX_CHARS_PER_FILE)
      chunks.push({ content: transcript, oversized: true });
    else current = appendTranscript(current, transcript);
  }
  closeCurrent();
  return chunks;
};

const writeChunk = (options: {
  readonly chunk: TranscriptChunk;
  readonly host: hostTypes.HostShape;
  readonly index: number;
  readonly outputDir: string;
}) =>
  Effect.gen(function* () {
    const { chunk, host } = options;
    const filename = transcriptFileName(options.index);
    yield* host.writeTextFile(host.join(options.outputDir, filename), chunk.content);
    const written = `Wrote ${filename} (${chunk.content.length} chars)`;
    yield* scriptOutput.print(
      chunk.oversized ? styleText("yellow", `${written} - oversized`) : written,
    );
    return filename;
  });

const writeTranscriptFiles = (
  host: hostTypes.HostShape,
  outputDir: string,
  transcripts: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const outputFiles = yield* Effect.forEach(chunkTranscripts(transcripts), (chunk, index) =>
      writeChunk({ chunk, host, index, outputDir }),
    );
    yield* scriptOutput.print(`\nCreated ${outputFiles.length} transcript file(s) in ${outputDir}`);
    return outputFiles;
  });

const agentsMdSectionFor = (host: hostTypes.HostShape, cwd: string) =>
  Effect.gen(function* () {
    const candidates = [host.join(homedir(), ".msa/agent/AGENTS.md"), host.join(cwd, "AGENTS.md")];
    const agentsMdFiles = yield* Effect.filter(candidates, (file) => host.exists(file));
    const section =
      agentsMdFiles.length > 0
        ? `STEP 1: Read the existing AGENTS.md file(s) to see what's already encoded:\n${agentsMdFiles.join("\n")}\n\nSTEP 2: `
        : "";
    return { agentsMdFiles, section };
  });

const reportOutcome = (options: {
  readonly failed: string;
  readonly host: hostTypes.HostShape;
  readonly missing: string;
  readonly output: string;
  readonly success: boolean;
  readonly written: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    if (options.success && (yield* options.host.exists(options.output))) {
      return yield* options.written;
    }
    return yield* scriptOutput.printError(
      options.success ? styleText("yellow", options.missing) : styleText("red", options.failed),
    );
  });

const analyzeFile = (options: {
  readonly file: string;
  readonly host: hostTypes.HostShape;
  readonly outputDir: string;
  readonly prompt: string;
}) =>
  Effect.gen(function* () {
    const { file, host, outputDir, prompt } = options;
    const summaryFile = file.replace(".txt", ".summary.txt");
    const filePath = host.join(outputDir, file);
    const summaryPath = host.join(outputDir, summaryFile);
    const fileContent = yield* host.readText(filePath);
    yield* scriptOutput.print(`Analyzing ${file} (${fileContent.length} chars)...`);
    const lineCount = fileContent.split("\n").length;
    const success = yield* runSubagent({
      cwd: outputDir,
      host,
      prompt: `${prompt}\n\nThe file ${filePath} has ${lineCount} lines. Read it in full using chunked reads, then write your analysis to ${summaryPath}`,
    });
    yield* reportOutcome({
      failed: `  Failed to analyze ${file}`,
      host,
      missing: `  Agent finished but did not write ${summaryFile}`,
      output: summaryPath,
      success,
      written: scriptOutput.print(styleText("green", `  -> ${summaryFile}`)),
    });
  });

const aggregate = (options: {
  readonly agentsMdFiles: ReadonlyArray<string>;
  readonly host: hostTypes.HostShape;
  readonly outputDir: string;
}) =>
  Effect.gen(function* () {
    const { agentsMdFiles, host, outputDir } = options;
    const names = yield* host.readDirectory(outputDir);
    const summaryFiles = [...names.filter((name) => name.endsWith(".summary.txt"))].sort();
    yield* scriptOutput.print("\n=== Individual Analysis Complete ===");
    yield* scriptOutput.print(`Created ${summaryFiles.length} summary files`);
    if (summaryFiles.length === 0) {
      yield* scriptOutput.print(
        styleText("yellow", "No summary files created. Nothing to aggregate."),
      );
      return;
    }
    yield* scriptOutput.print("\nAggregating findings into final summary...");
    const finalSummaryPath = host.join(outputDir, "FINAL-SUMMARY.txt");
    const success = yield* runSubagent({
      cwd: outputDir,
      host,
      prompt: aggregationPrompt({
        agentsMdFiles,
        finalSummaryPath,
        summaryPaths: summaryFiles.map((file) => host.join(outputDir, file)).join("\n"),
      }),
    });
    yield* reportOutcome({
      failed: "Failed to create final summary",
      host,
      missing: "Agent finished but did not write final summary",
      output: finalSummaryPath,
      success,
      written: Effect.andThen(
        scriptOutput.print(styleText("green", "\n=== Final Summary Created ===")),
        scriptOutput.print(styleText("green", `  ${finalSummaryPath}`)),
      ),
    });
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = parseArgs(host);
  yield* host.makeDirectory(args.outputDir);
  const sessionDir = host.join(homedir(), ".msa/agent/sessions", cwdToSessionDir(host, args.cwd));
  if (!(yield* host.exists(sessionDir))) {
    yield* scriptOutput.printError(`No sessions found for ${args.cwd}`);
    yield* scriptOutput.printError(`Expected: ${sessionDir}`);
    return yield* Effect.sync(() => process.exit(1));
  }
  const transcripts = yield* collectTranscripts(host, sessionDir);
  if (transcripts.length === 0) {
    yield* scriptOutput.printError("No transcripts found");
    return yield* Effect.sync(() => process.exit(1));
  }
  const outputFiles = yield* writeTranscriptFiles(host, args.outputDir, transcripts);
  if (!args.analyze) {
    yield* scriptOutput.print("\nRun with --analyze to spawn msa subagents for pattern analysis.");
    return;
  }
  const { agentsMdFiles, section } = yield* agentsMdSectionFor(host, args.cwd);
  const prompt = analysisPrompt(section);
  yield* scriptOutput.print("\nSpawning subagents for analysis...");
  yield* Effect.forEach(outputFiles, (file) =>
    analyzeFile({ file, host, outputDir: args.outputDir, prompt }),
  );
  yield* aggregate({ agentsMdFiles, host, outputDir: args.outputDir });
});

runScript(program);
