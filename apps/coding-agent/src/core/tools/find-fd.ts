import { Effect } from "effect";

import toolsManager from "../../utils/tools-manager.ts";
import command from "../platform/command.ts";
import platformModule from "../platform/index.ts";
import findSupport from "./find-support.ts";
import type findSupportTypes from "./find-support.types.ts";
import pathUtils from "./path-utils.ts";

const { ToolFailure, fromPromise } = platformModule;
const { pathExists } = pathUtils;
const { formatFindOutput, noFilesFound, relativizeFindResultPath } = findSupport;
const { ensureTool } = toolsManager;
const { runCommand } = command;

const isInsideGitRepo = (searchPath: string) =>
  Effect.gen(function* () {
    for (let current = searchPath; ;) {
      const hasGit = yield* fromPromise(() => pathExists(platformModule.join(current, ".git")));
      if (hasGit) return true;
      const parent = platformModule.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  });

const fdArguments = (
  { pattern, searchPath, effectiveLimit }: findSupportTypes.FindRequest,
  insideGitRepo: boolean,
) => {
  const args = ["--glob", "--color=never", "--hidden"];
  if (!insideGitRepo) args.push("--no-require-git");
  args.push("--max-results", String(effectiveLimit));
  let effectivePattern = pattern;
  if (pattern.includes("/")) {
    args.push("--full-path");
    if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
      effectivePattern = `**/${pattern}`;
    }
    if (process.platform === "win32") {
      effectivePattern = effectivePattern.replaceAll("/", String.raw`[/\\]`);
    }
  }
  args.push("--", effectivePattern, searchPath);
  return args;
};

const globWithFd = Effect.fn("findWithFd")(function* (request: findSupportTypes.FindRequest) {
  const fdPath = yield* fromPromise(() => ensureTool("fd"));
  if (fdPath === undefined || fdPath === "") {
    return yield* new ToolFailure({ message: "fd is not available and could not be downloaded" });
  }
  const insideGitRepo = yield* isInsideGitRepo(request.searchPath);
  const { lines, stderr, exitCode } = yield* fromPromise((signal) =>
    runCommand({ args: fdArguments(request, insideGitRepo), file: fdPath, signal }),
  );
  const output = lines.join("\n");
  if (exitCode !== 0 && output === "") {
    const message = stderr.trim();
    return yield* new ToolFailure({
      message: message === "" ? `fd exited with code ${exitCode}` : message,
    });
  }
  if (output === "") return noFilesFound;
  const results = lines
    .map((line) => line.replace(/\r$/u, "").trim())
    .filter((line) => line !== "")
    .map((line) => relativizeFindResultPath(line, request.searchPath));
  const { effectiveLimit } = request;
  return formatFindOutput({
    effectiveLimit,
    limitNotice: `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
    results,
  });
});

const findFd = {
  globWithFd,
};

export default findFd;
