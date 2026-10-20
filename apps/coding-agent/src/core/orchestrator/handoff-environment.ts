import { Effect } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { findExecutableOnPath } from "../../utils/shell.ts";
import { execCommand } from "../exec.ts";
import type { HandoffEnvironment, HandoffItem } from "./handoff-render.ts";
import { repoStates } from "./repo-state.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const LIST_LIMIT = 100;

const PullList = Schema.Struct({
  headRefName: Schema.String,
  isDraft: Schema.Boolean,
  number: Schema.Finite,
  title: Schema.String,
}).pipe(Schema.Array, Schema.fromJsonString);

const IssueList = Schema.Struct({ number: Schema.Finite, title: Schema.String }).pipe(
  Schema.Array,
  Schema.fromJsonString,
);

const REMOTE_PATH = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/u;

async function output(command: string, args: string[], cwd: string): Promise<string | undefined> {
  const result = await execCommand(command, args, cwd, { timeout: COMMAND_TIMEOUT_MS });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

async function repositoryOf(cwd: string): Promise<string | undefined> {
  const remote = await output("git", ["remote", "get-url", "origin"], cwd);
  return remote === undefined ? undefined : REMOTE_PATH.exec(remote)?.[1];
}

async function gh(cwd: string, args: string[]): Promise<string | undefined> {
  if (findExecutableOnPath("gh") === null) return undefined;
  return output("gh", args, cwd);
}

async function pullsOf(cwd: string): Promise<readonly HandoffItem[] | undefined> {
  const json = await gh(cwd, [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    String(LIST_LIMIT),
    "--json",
    "number,title,headRefName,isDraft",
  ]);
  if (json === undefined) return undefined;
  const decoded = Schema.decodeOption(PullList)(json);
  if (Option.isNone(decoded)) return undefined;
  return decoded.value.map((pull) => ({
    detail: `（${pull.headRefName}${pull.isDraft ? "、draft" : ""}）`,
    number: pull.number,
    title: pull.title,
  }));
}

async function issuesOf(cwd: string): Promise<readonly HandoffItem[] | undefined> {
  const json = await gh(cwd, [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(LIST_LIMIT),
    "--json",
    "number,title",
  ]);
  if (json === undefined) return undefined;
  const decoded = Schema.decodeOption(IssueList)(json);
  if (Option.isNone(decoded)) return undefined;
  return decoded.value.map((issue) => ({ detail: "", number: issue.number, title: issue.title }));
}

export async function gatherEnvironment(cwd: string, version: string): Promise<HandoffEnvironment> {
  const [repository, state, pulls, issues] = await Promise.all([
    repositoryOf(cwd),
    Effect.runPromise(repoStates.read(cwd)),
    pullsOf(cwd),
    issuesOf(cwd),
  ]);
  return {
    branch: state.branch === "-" ? undefined : state.branch,
    cwd,
    issues,
    pulls,
    repository,
    version,
  };
}
