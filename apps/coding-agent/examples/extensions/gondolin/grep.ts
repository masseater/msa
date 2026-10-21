import type { VM } from "@earendil-works/gondolin";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, Option } from "effect";

import platform from "../../../src/core/platform/index.ts";
import ops from "./ops.ts";
import paths from "./paths.ts";

const { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } = codingAgent;
const { failIfAborted, walkGuestFiles } = ops;
const { matchesToolGlob, signalOption, toGuestPath } = paths;

const DEFAULT_GREP_LIMIT = 100;

interface TextToolResult<TDetails> {
  content: { type: "text"; text: string }[];
  details: TDetails | undefined;
}

interface GrepState {
  readonly params: codingAgentTypes.GrepToolInput;
  readonly matcher: (line: string) => boolean;
  readonly contextLines: number;
  readonly limit: number;
  readonly rootIsDirectory: boolean;
  readonly outputLines: string[];
  matchCount: number;
  matchLimitReached: boolean;
  linesTruncated: boolean;
}

function createLineMatcher(
  pattern: string,
  literal: boolean | undefined,
  ignoreCase: boolean | undefined,
) {
  if (literal === true) {
    const needle = ignoreCase === true ? pattern.toLowerCase() : pattern;
    return (line: string) => (ignoreCase === true ? line.toLowerCase() : line).includes(needle);
  }
  const regex = new RegExp(pattern, ignoreCase === true ? "iu" : "u");
  return (line: string) => regex.test(line);
}

function appendGrepBlock(state: GrepState, lines: string[], path: string, lineIndex: number) {
  const start = Math.max(0, lineIndex - state.contextLines);
  const end = Math.min(lines.length - 1, lineIndex + state.contextLines);
  for (let index = start; index <= end; index++) {
    const { text, wasTruncated } = truncateLine((lines[index] ?? "").replace(/\r/gu, ""));
    if (wasTruncated) state.linesTruncated = true;
    const separator = index === lineIndex ? ":" : "-";
    state.outputLines.push(`${path}${separator}${index + 1}${separator} ${text}`);
  }
}

const grepFile = (
  vm: VM,
  state: GrepState,
  signal: AbortSignal | undefined,
  file: { guestPath: string; relativePath: string },
) =>
  Effect.gen(function* () {
    const { glob } = state.params;
    if (glob !== undefined && glob !== "" && !matchesToolGlob(file.relativePath, glob)) return true;
    const content = yield* Effect.option(
      Effect.tryPromise(() =>
        vm.fs.readFile(file.guestPath, { encoding: "utf8", ...signalOption(signal) }),
      ),
    );
    if (Option.isNone(content)) return true;
    const lines = content.value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
    const path = state.rootIsDirectory
      ? file.relativePath
      : platform.posix.basename(file.guestPath);
    for (const [index, line] of lines.entries()) {
      yield* failIfAborted(signal);
      if (!state.matcher(line)) continue;
      state.matchCount++;
      appendGrepBlock(state, lines, path, index);
      if (state.matchCount >= state.limit) {
        state.matchLimitReached = true;
        return false;
      }
    }
    return true;
  });

function summarize(state: GrepState): TextToolResult<codingAgentTypes.GrepToolDetails> {
  if (state.matchCount === 0)
    return { content: [{ text: "No matches found", type: "text" }], details: undefined };
  const truncation = truncateHead(state.outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const details: codingAgentTypes.GrepToolDetails = {};
  const notices: string[] = [];
  if (state.matchLimitReached) {
    details.matchLimitReached = state.limit;
    notices.push(`${state.limit} matches limit reached`);
  }
  if (state.linesTruncated) {
    details.linesTruncated = true;
    notices.push("long lines truncated");
  }
  if (truncation.truncated) {
    details.truncation = truncation;
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }
  const suffix = notices.length > 0 ? `\n\n[${notices.join(". ")}]` : "";
  return {
    content: [{ text: truncation.content + suffix, type: "text" }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}

const executeGondolinGrep = (
  vm: VM,
  localCwd: string,
  params: codingAgentTypes.GrepToolInput,
  signal?: AbortSignal,
): Promise<TextToolResult<codingAgentTypes.GrepToolDetails>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const root = toGuestPath(localCwd, params.path ?? ".");
      const rootStat = yield* Effect.promise(() => vm.fs.stat(root, signalOption(signal)));
      const state: GrepState = {
        contextLines: params.context !== undefined && params.context > 0 ? params.context : 0,
        limit: Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT),
        linesTruncated: false,
        matchCount: 0,
        matchLimitReached: false,
        matcher: createLineMatcher(params.pattern, params.literal, params.ignoreCase),
        outputLines: [],
        params,
        rootIsDirectory: rootStat.isDirectory(),
      };
      yield* walkGuestFiles(
        vm,
        root,
        (guestPath, relativePath) =>
          state.matchCount >= state.limit
            ? Effect.succeed(false)
            : grepFile(vm, state, signal, { guestPath, relativePath }),
        signal,
      );
      return summarize(state);
    }),
  );

const grep = { executeGondolinGrep };

export default grep;
