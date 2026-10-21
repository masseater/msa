import { NodeServices } from "@effect/platform-node";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Data, Effect, FileSystem, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Type } from "typebox";

const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } = codingAgent;

const { Text } = tui;

const runtime = ManagedRuntime.make(NodeServices.layer);

const RgParams = Type.Object({
  glob: Type.Optional(Type.String({ description: "File glob pattern, e.g. '*.ts'" })),
  path: Type.Optional(
    Type.String({ description: "Directory to search (default: current directory)" }),
  ),
  pattern: Type.String({ description: "Search pattern (regex)" }),
});

interface RgDetails {
  pattern: string;
  path?: string | undefined;
  glob?: string | undefined;
  matchCount: number;
  truncation?: codingAgentTypes.TruncationResult;
  fullOutputPath?: string;
}

interface RgParamsValue {
  pattern: string;
  path?: string | undefined;
  glob?: string | undefined;
}

class RgError extends Data.TaggedError("RgError")<{ readonly message: string }> {}

const buildArgs = (params: RgParamsValue): string[] => {
  const args = ["--line-number", "--color=never"];
  if (params.glob !== undefined && params.glob.length > 0) args.push("--glob", params.glob);
  args.push(params.pattern);
  args.push(params.path || ".");
  return args;
};

const runRipgrep = (cwd: string, args: string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make("rg", args, { cwd }));
        const [stdout, exitCode] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
          { concurrency: 2 },
        );
        return { exitCode, stdout };
      }),
    );
  });

const noMatchResult = (params: RgParamsValue) => ({
  content: [{ text: "No matches found", type: "text" as const }],
  details: {
    glob: params.glob,
    matchCount: 0,
    path: params.path,
    pattern: params.pattern,
  } as RgDetails,
});

const saveFullOutput = (output: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-rg-" });
    const tempFile = path.join(tempDir, "output.txt");
    yield* fs.writeFileString(tempFile, output);
    return tempFile;
  });

const truncationNote = (
  truncation: codingAgentTypes.TruncationResult,
  tempFile: string,
): string => {
  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  return (
    `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
    ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.` +
    ` Full output saved to: ${tempFile}]`
  );
};

const search = (cwd: string, params: RgParamsValue) =>
  Effect.gen(function* () {
    const { stdout, exitCode } = yield* runRipgrep(cwd, buildArgs(params));

    if (exitCode === 1 || stdout.trim().length === 0) {
      return noMatchResult(params);
    }
    if (exitCode !== 0) {
      return yield* new RgError({ message: `ripgrep failed with exit code ${exitCode}` });
    }

    const truncation = truncateHead(stdout, {
      maxBytes: DEFAULT_MAX_BYTES,
      maxLines: DEFAULT_MAX_LINES,
    });
    const matchCount = stdout.split("\n").filter((line) => line.trim()).length;
    const details: RgDetails = {
      glob: params.glob,
      matchCount,
      path: params.path,
      pattern: params.pattern,
    };

    let resultText = truncation.content;
    if (truncation.truncated) {
      const tempFile = yield* saveFullOutput(stdout);
      details.truncation = truncation;
      details.fullOutputPath = tempFile;
      resultText += truncationNote(truncation, tempFile);
    }

    return { content: [{ text: resultText, type: "text" as const }], details };
  });

const renderCall = (args: RgParamsValue, theme: codingAgentTypes.Theme): tuiTypes.Text => {
  let text = theme.fg("toolTitle", theme.bold("rg "));
  text += theme.fg("accent", `"${args.pattern}"`);
  if (args.path !== undefined && args.path.length > 0) {
    text += theme.fg("muted", ` in ${args.path}`);
  }
  if (args.glob !== undefined && args.glob.length > 0) {
    text += theme.fg("dim", ` --glob ${args.glob}`);
  }
  return new Text(text, 0, 0);
};

const expandedOutput = (text: string, theme: codingAgentTypes.Theme): string => {
  const lines = text.split("\n").slice(0, 20);
  const shown = lines.map((line) => `\n${theme.fg("dim", line)}`).join("");
  return text.split("\n").length > 20
    ? `${shown}\n${theme.fg("muted", "... (use read tool to see full output)")}`
    : shown;
};

const renderResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: codingAgentTypes.Theme,
): tuiTypes.Text => {
  const details = result.details as RgDetails | undefined;

  if (options.isPartial) {
    return new Text(theme.fg("warning", "Searching..."), 0, 0);
  }
  if (details === undefined || details.matchCount === 0) {
    return new Text(theme.fg("dim", "No matches found"), 0, 0);
  }

  let text = theme.fg("success", `${details.matchCount} matches`);
  if (details.truncation?.truncated === true) {
    text += theme.fg("warning", " (truncated)");
  }

  if (options.expanded) {
    const content = result.content[0];
    if (content?.type === "text") {
      text += expandedOutput(content.text ?? "", theme);
    }
    if (details.fullOutputPath !== undefined && details.fullOutputPath.length > 0) {
      text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
    }
  }

  return new Text(text, 0, 0);
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerTool({
    description: `Search file contents using ripgrep. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). If truncated, full output is saved to a temp file.`,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runtime.runPromise(search(ctx.cwd, params)),
    label: "ripgrep",
    name: "rg",
    parameters: RgParams,
    renderCall,
    renderResult,
  });
}
