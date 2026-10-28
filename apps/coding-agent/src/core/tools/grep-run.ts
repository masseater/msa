import { Effect, FileSystem } from "effect";

import toolsManager from "../../utils/tools-manager.ts";
import command from "../platform/command.ts";
import platform from "../platform/index.ts";
import nodeRuntime from "../platform/runtime.ts";
import GrepFormatter from "./grep-format.ts";
import grepSupport from "./grep-support.ts";
import type grepSupportTypes from "./grep-support.types.ts";
import pathUtils from "./path-utils.ts";
import RgMatchCollector from "./rg-match-collector.ts";

const { DEFAULT_GREP_LIMIT, formatGrepOutput, rgArguments } = grepSupport;
const { ToolFailure, abortedBy, fromPromise, nonEmptyOr, rethrowCause, unwrapForeign } = platform;
const { resolveToCwd } = pathUtils;
const { ensureTool } = toolsManager;
const { streamCommand } = command;
const defaultGrepOperations: grepSupportTypes.GrepOperations = {
  isDirectory: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.stat(path)).pipe(
          Effect.map((info) => info.type === "Directory"),
        ),
      ),
    ),
  readFile: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.readFileString(path, "utf-8"))),
    ),
};

const resolveRipgrep = Effect.gen(function* () {
  const rgPath = yield* fromPromise(() => ensureTool("rg"));
  if (rgPath === undefined || rgPath === "") {
    return yield* ToolFailure.make({
      message: "ripgrep (rg) is not available and could not be downloaded",
    });
  }
  return rgPath;
});

const searchWithRipgrep = Effect.fn("ripgrep")(function* (
  rgPath: string,
  request: grepSupportTypes.GrepRequest,
) {
  const collector = new RgMatchCollector(request.effectiveLimit);
  const { stoppedEarly, stderr, exitCode } = yield* fromPromise((signal) =>
    streamCommand({
      args: rgArguments(request),
      file: rgPath,
      onLine: collector.onLine,
      signal,
    }),
  );
  if (!stoppedEarly && exitCode !== 0 && exitCode !== 1) {
    const message = stderr.trim();
    return yield* ToolFailure.make({
      message: message === "" ? `ripgrep exited with code ${exitCode}` : message,
    });
  }
  return collector;
});

const runGrep = Effect.fn("grep")(function* (
  ops: grepSupportTypes.GrepOperations,
  request: Omit<grepSupportTypes.GrepRequest, "isDirectory">,
) {
  const rgPath = yield* resolveRipgrep;
  const isDirectory = yield* fromPromise(() => ops.isDirectory(request.searchPath)).pipe(
    Effect.catchTag("ForeignError", () =>
      Effect.fail(ToolFailure.make({ message: `Path not found: ${request.searchPath}` })),
    ),
  );
  const collector = yield* searchWithRipgrep(rgPath, { ...request, isDirectory });
  if (collector.matchCount === 0) {
    return { content: [{ text: "No matches found", type: "text" as const }], details: undefined };
  }
  const formatter = new GrepFormatter({
    contextValue: request.contextValue,
    isDirectory,
    ops,
    searchPath: request.searchPath,
  });
  const outputLines: string[] = [];
  for (const match of collector.matches) {
    outputLines.push(...(yield* formatter.formatMatch(match)));
  }
  return formatGrepOutput({
    effectiveLimit: request.effectiveLimit,
    linesTruncated: formatter.linesTruncated,
    matchLimitReached: collector.matchLimitReached,
    outputLines,
  });
});

interface GrepCall {
  cwd: string;
  input: grepSupportTypes.GrepCallInput;
  ops: grepSupportTypes.GrepOperations;
  signal: AbortSignal | undefined;
}

const executeGrep = ({ cwd, input, ops, signal }: GrepCall) =>
  Effect.runPromise(
    unwrapForeign(
      runGrep(ops, {
        contextValue: input.context !== undefined && input.context > 0 ? input.context : 0,
        effectiveLimit: Math.max(1, input.limit ?? DEFAULT_GREP_LIMIT),
        glob: input.glob,
        ignoreCase: input.ignoreCase,
        literal: input.literal,
        pattern: input.pattern,
        searchPath: resolveToCwd(nonEmptyOr(input.path, "."), cwd),
      }).pipe(abortedBy(signal)),
    ),
  );

const grepRun = {
  defaultGrepOperations,
  executeGrep,
};

export default grepRun;
