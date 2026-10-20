import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import toolsManager from "../../utils/tools-manager.ts";
import command from "../platform/command.ts";
import platform from "../platform/index.ts";
import GrepFormatter from "./grep-format.ts";
import grepSupport from "./grep-support.ts";
import type grepSupportTypes from "./grep-support.types.ts";
import RgMatchCollector from "./rg-match-collector.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { formatGrepOutput, rgArguments } = grepSupport;
const { ToolFailure, fromPromise, rethrowCause } = platform;
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
    return yield* new ToolFailure({
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
    return yield* new ToolFailure({
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

const grepRun = {
  defaultGrepOperations,
  runGrep,
};

export default grepRun;
