import { Effect } from "effect";

import exec from "../exec.ts";
import platform from "../platform/index.ts";
import platformPath from "../platform/path.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { execCommand } = exec;
const { files } = platform;
const { store } = storeModule;

const TIMEOUT_MS = 60_000;
const LIMIT = 8000;

function clip(text: string): string {
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT)}\n[…]`;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Effect.Effect<string | undefined> {
  return Effect.tryPromise(() =>
    execCommand(command, [...args], cwd, { timeout: TIMEOUT_MS }),
  ).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
}

function gh(
  runtime: runtimeTypes.Runtime,
  args: readonly string[],
  cwd: string,
): Effect.Effect<string | undefined> {
  return Effect.tryPromise(() => runtime.options.runGh(args, cwd)).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
}

function pullRequestText(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  cwd: string,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const pull = store.pullRequestOf(runtime.database, task.mergeInto ?? task.id);
    if (pull === undefined) return "(no pull request yet)";
    const read = yield* gh(
      runtime,
      [
        "pr",
        "view",
        String(pull.number),
        "--json",
        "title,body",
        "--jq",
        '.title + "\\n\\n" + .body',
      ],
      cwd,
    );
    const text =
      read ??
      (pull.verified === null ? undefined : `${pull.verified.title}\n\n${pull.verified.body}`);
    return `#${pull.number} (${pull.branch} into ${pull.base})\n${text ?? "(the body could not be read)"}`;
  });
}

function agentsText(cwd: string): Effect.Effect<string> {
  return Effect.gen(function* () {
    const root = (yield* run("git", ["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
    const text = yield* Effect.tryPromise(() =>
      files.readText(platformPath.join(root, "AGENTS.md")),
    ).pipe(Effect.orElseSucceed(() => undefined));
    return text === undefined ? "(no AGENTS.md at the root)" : clip(text);
  });
}

function history(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  workspace: orchestratorTypesTypes.Workspace,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const { cwd } = workspace;
    const log = yield* run("git", ["log", "-n", "40", "--format=%h %s%n%b%n--"], cwd);
    const issues = yield* gh(
      runtime,
      [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        "40",
        "--json",
        "number,state,title",
        "--jq",
        '.[] | "#\\(.number) [\\(.state)] \\(.title)"',
      ],
      cwd,
    );
    return [
      `<pull-request>\n${yield* pullRequestText(runtime, task, cwd)}\n</pull-request>`,
      `<agents-md>\n${yield* agentsText(cwd)}\n</agents-md>`,
      `<commit-log>\n${log === undefined ? "(no git history here)" : clip(log)}\n</commit-log>`,
      `<issues>\n${issues === undefined ? "(gh could not list the issues)" : clip(issues)}\n</issues>`,
    ].join("\n");
  });
}

const triageContext = { history };

export default triageContext;
