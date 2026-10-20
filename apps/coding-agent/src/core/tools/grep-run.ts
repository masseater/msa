import { Effect, FileSystem } from "effect";

import { ensureTool } from "../../utils/tools-manager.ts";
import { streamCommand } from "../platform/command.ts";
import { ToolFailure, fromPromise, platformRuntime, rethrowCause } from "../platform/index.ts";
import { GrepFormatter } from "./grep-format.ts";
import {
  type GrepOperations,
  type GrepRequest,
  RgMatchCollector,
  formatGrepOutput,
  rgArguments,
} from "./grep-support.ts";

export const defaultGrepOperations: GrepOperations = {
  isDirectory: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.stat(path)).pipe(
          Effect.map((info) => info.type === "Directory"),
        ),
      ),
    ),
  readFile: (path) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.readFileString(path, "utf-8"))),
    ),
};

const resolveRipgrep = Effect.gen(function* () {
  const rgPath = yield* fromPromise(() => ensureTool("rg"));
  if (rgPath === undefined || rgPath === "") {
    return yield* new ToolFailure({
      message: "ripgrep (rg) is not available and could not be downloaded",
    });
  }
  return rgPath;
});

const searchWithRipgrep = Effect.fn("ripgrep")(function* (rgPath: string, request: GrepRequest) {
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
    return yield* new ToolFailure({
      message: message === "" ? `ripgrep exited with code ${exitCode}` : message,
    });
  }
  return collector;
});

export const runGrep = Effect.fn("grep")(function* (
  ops: GrepOperations,
  request: Omit<GrepRequest, "isDirectory">,
) {
  const rgPath = yield* resolveRipgrep;
  const isDirectory = yield* fromPromise(() => ops.isDirectory(request.searchPath)).pipe(
    Effect.catchTag("ForeignError", () =>
      Effect.fail(new ToolFailure({ message: `Path not found: ${request.searchPath}` })),
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
