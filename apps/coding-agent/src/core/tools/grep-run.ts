import { Effect, FileSystem } from "effect";

import { ensureTool } from "../../utils/tools-manager.ts";
import { streamCommand } from "../platform/command.ts";
import { fromPromise, platformRuntime, rethrowCause, ToolFailure } from "../platform/index.ts";
import { GrepFormatter } from "./grep-format.ts";
import {
  formatGrepOutput,
  type GrepOperations,
  type GrepRequest,
  RgMatchCollector,
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
      file: rgPath,
      args: rgArguments(request),
      signal,
      onLine: collector.onLine,
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
    return { content: [{ type: "text" as const, text: "No matches found" }], details: undefined };
  }
  const formatter = new GrepFormatter({
    ops,
    searchPath: request.searchPath,
    isDirectory,
    contextValue: request.contextValue,
  });
  const outputLines: string[] = [];
  for (const match of collector.matches) {
    outputLines.push(...(yield* formatter.formatMatch(match)));
  }
  return formatGrepOutput({
    outputLines,
    effectiveLimit: request.effectiveLimit,
    matchLimitReached: collector.matchLimitReached,
    linesTruncated: formatter.linesTruncated,
  });
});
