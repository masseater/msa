import { homedir } from "node:os";
import { styleText } from "node:util";

import { Console, Effect, Predicate } from "effect";

import {
  parseSessionEntries,
  type SessionMessageEntry,
} from "../apps/coding-agent/src/core/session-manager.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { runSubagent } from "./session-transcripts-agent.ts";
import { aggregationPrompt, analysisPrompt } from "./session-transcripts-prompts.ts";

const MAX_CHARS_PER_FILE = 100_000;

interface Args {
  readonly analyze: boolean;
  readonly cwd: string;
  readonly outputDir: string;
}

const cwdToSessionDir = (host: HostShape, cwd: string): string =>
  `--${host.resolve(cwd).replaceAll("/", "-").slice(1)}--`;

const extractTextContent = (content: unknown): string => {
  if (Predicate.isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block: unknown): block is { readonly text: string } =>
        Predicate.isObject(block) &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        Predicate.isString(block.text) &&
        block.text !== "",
    )
    .map((block) => block.text)
    .join("\n");
};

const parseSession = (host: HostShape, filePath: string) =>
  Effect.gen(function* () {
    const entries = parseSessionEntries(yield* host.readText(filePath));
    const messages: Array<string> = [];
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const { role, content } = (entry as SessionMessageEntry).message as {
        role?: string;
        content?: unknown;
      };
      if (role !== "user" && role !== "assistant") continue;
      const text = extractTextContent(content);
      if (text.trim() === "") continue;
      messages.push(`[${role.toUpperCase()}]\n${text}`);
    }
    return messages;
  });

const parseArgs = (host: HostShape): Args => {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const outputValue = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const flagIndices = new Set<number>([args.indexOf("--analyze")]);
  if (outputIndex !== -1) {
    flagIndices.add(outputIndex);
    flagIndices.add(outputIndex + 1);
  }
  const cwdArg = args.find(
    (arg, index) => !flagIndices.has(index) && !arg.startsWith("--") && arg !== "",
  );
  return {
    analyze: args.includes("--analyze"),
    cwd: host.resolve(cwdArg ?? process.cwd()),
    outputDir:
      outputValue === undefined || outputValue === ""
        ? host.resolve("./session-transcripts")
        : host.resolve(outputValue),
  };
};

const transcriptFileName = (index: number): string =>
  `session-transcripts-${String(index).padStart(3, "0")}.txt`;

const collectTranscripts = (host: HostShape, sessionDir: string) =>
  Effect.gen(function* () {
    const names = yield* host.readDirectory(sessionDir);
    const sessionFiles = [...names.filter((name) => name.endsWith(".jsonl"))].sort();
    yield* Console.log(`Found ${sessionFiles.length} session files in ${sessionDir}`);
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

const writeTranscriptFiles = (
  host: HostShape,
  outputDir: string,
  transcripts: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const outputFiles: Array<string> = [];
    let currentContent = "";
    let fileIndex = 0;
    const flush = (oversized: string | undefined) =>
      Effect.gen(function* () {
        const content = oversized ?? currentContent;
        const filename = transcriptFileName(fileIndex);
        yield* host.writeText(host.join(outputDir, filename), content);
        outputFiles.push(filename);
        yield* oversized === undefined
          ? Console.log(`Wrote ${filename} (${content.length} chars)`)
          : Console.log(
              styleText("yellow", `Wrote ${filename} (${content.length} chars) - oversized`),
            );
        if (oversized === undefined) currentContent = "";
        fileIndex += 1;
      });
    for (const transcript of transcripts) {
      if (
        currentContent.length > 0 &&
        currentContent.length + transcript.length + 2 > MAX_CHARS_PER_FILE
      ) {
        yield* flush(undefined);
      }
      if (transcript.length > MAX_CHARS_PER_FILE) {
        if (currentContent.length > 0) yield* flush(undefined);
        yield* flush(transcript);
        continue;
      }
      currentContent += (currentContent === "" ? "" : "\n\n") + transcript;
    }
    if (currentContent.length > 0) yield* flush(undefined);
    yield* Console.log(`\nCreated ${outputFiles.length} transcript file(s) in ${outputDir}`);
    return outputFiles;
  });

const agentsMdSectionFor = (host: HostShape, cwd: string) =>
  Effect.gen(function* () {
    const candidates = [host.join(homedir(), ".msa/agent/AGENTS.md"), host.join(cwd, "AGENTS.md")];
    const agentsMdFiles = yield* Effect.filter(candidates, (file) => host.exists(file));
    const section =
      agentsMdFiles.length > 0
        ? `STEP 1: Read the existing AGENTS.md file(s) to see what's already encoded:\n${agentsMdFiles.join("\n")}\n\nSTEP 2: `
        : "";
    return { agentsMdFiles, section };
  });

const analyzeFile = (options: {
  readonly file: string;
  readonly host: HostShape;
  readonly outputDir: string;
  readonly prompt: string;
}) =>
  Effect.gen(function* () {
    const { file, host, outputDir, prompt } = options;
    const summaryFile = file.replace(".txt", ".summary.txt");
    const filePath = host.join(outputDir, file);
    const summaryPath = host.join(outputDir, summaryFile);
    const fileContent = yield* host.readText(filePath);
    yield* Console.log(`Analyzing ${file} (${fileContent.length} chars)...`);
    const lineCount = fileContent.split("\n").length;
    const success = yield* runSubagent({
      cwd: outputDir,
      host,
      prompt: `${prompt}\n\nThe file ${filePath} has ${lineCount} lines. Read it in full using chunked reads, then write your analysis to ${summaryPath}`,
    });
    if (success && (yield* host.exists(summaryPath))) {
      yield* Console.log(styleText("green", `  -> ${summaryFile}`));
      return;
    }
    yield* success
      ? Console.error(styleText("yellow", `  Agent finished but did not write ${summaryFile}`))
      : Console.error(styleText("red", `  Failed to analyze ${file}`));
  });

const aggregate = (options: {
  readonly agentsMdFiles: ReadonlyArray<string>;
  readonly host: HostShape;
  readonly outputDir: string;
}) =>
  Effect.gen(function* () {
    const { agentsMdFiles, host, outputDir } = options;
    const names = yield* host.readDirectory(outputDir);
    const summaryFiles = [...names.filter((name) => name.endsWith(".summary.txt"))].sort();
    yield* Console.log("\n=== Individual Analysis Complete ===");
    yield* Console.log(`Created ${summaryFiles.length} summary files`);
    if (summaryFiles.length === 0) {
      yield* Console.log(styleText("yellow", "No summary files created. Nothing to aggregate."));
      return;
    }
    yield* Console.log("\nAggregating findings into final summary...");
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
    if (success && (yield* host.exists(finalSummaryPath))) {
      yield* Console.log(styleText("green", "\n=== Final Summary Created ==="));
      yield* Console.log(styleText("green", `  ${finalSummaryPath}`));
      return;
    }
    yield* success
      ? Console.error(styleText("yellow", "Agent finished but did not write final summary"))
      : Console.error(styleText("red", "Failed to create final summary"));
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = parseArgs(host);
  yield* host.makeDirectory(args.outputDir);
  const sessionDir = host.join(homedir(), ".msa/agent/sessions", cwdToSessionDir(host, args.cwd));
  if (!(yield* host.exists(sessionDir))) {
    yield* Console.error(`No sessions found for ${args.cwd}`);
    yield* Console.error(`Expected: ${sessionDir}`);
    return yield* Effect.sync(() => process.exit(1));
  }
  const transcripts = yield* collectTranscripts(host, sessionDir);
  if (transcripts.length === 0) {
    yield* Console.error("No transcripts found");
    return yield* Effect.sync(() => process.exit(1));
  }
  const outputFiles = yield* writeTranscriptFiles(host, args.outputDir, transcripts);
  if (!args.analyze) {
    yield* Console.log("\nRun with --analyze to spawn msa subagents for pattern analysis.");
    return;
  }
  const { agentsMdFiles, section } = yield* agentsMdSectionFor(host, args.cwd);
  const prompt = analysisPrompt(section);
  yield* Console.log("\nSpawning subagents for analysis...");
  yield* Effect.forEach(outputFiles, (file) =>
    analyzeFile({ file, host, outputDir: args.outputDir, prompt }),
  );
  yield* aggregate({ agentsMdFiles, host, outputDir: args.outputDir });
});

runScript(program);
