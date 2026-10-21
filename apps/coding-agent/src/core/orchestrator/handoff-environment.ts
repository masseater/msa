import { Effect } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import shell from "../../utils/shell.ts";
import awaitingModule from "../awaiting.ts";
import execModule from "../exec.ts";
import type handoffRenderTypes from "./handoff-render.types.ts";
import repoState from "./repo-state.ts";

const { awaited, awaiting } = awaitingModule;

const { execCommand } = execModule;
const { findExecutableOnPath } = shell;
const { repoStates } = repoState;

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

function output(command: string, args: string[], cwd: string): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const result = yield* awaited(
        execCommand(command, args, cwd, { timeout: COMMAND_TIMEOUT_MS }),
      );
      return yield* awaited(result.code === 0 ? result.stdout.trim() : undefined);
    }),
  );
}

function repositoryOf(cwd: string): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const remote = yield* awaited(output("git", ["remote", "get-url", "origin"], cwd));
      return yield* awaited(remote === undefined ? undefined : REMOTE_PATH.exec(remote)?.[1]);
    }),
  );
}

function gh(cwd: string, args: string[]): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (findExecutableOnPath("gh") === null) return yield* awaited(undefined);
      return yield* awaited(output("gh", args, cwd));
    }),
  );
}

function pullsOf(cwd: string): Promise<readonly handoffRenderTypes.HandoffItem[] | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const json = yield* awaited(
        gh(cwd, [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          String(LIST_LIMIT),
          "--json",
          "number,title,headRefName,isDraft",
        ]),
      );
      if (json === undefined) return yield* awaited(undefined);
      const decoded = Schema.decodeOption(PullList)(json);
      if (Option.isNone(decoded)) return yield* awaited(undefined);
      return yield* awaited(
        decoded.value.map((pull) => ({
          detail: `（${pull.headRefName}${pull.isDraft ? "、draft" : ""}）`,
          number: pull.number,
          title: pull.title,
        })),
      );
    }),
  );
}

function issuesOf(cwd: string): Promise<readonly handoffRenderTypes.HandoffItem[] | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const json = yield* awaited(
        gh(cwd, [
          "issue",
          "list",
          "--state",
          "open",
          "--limit",
          String(LIST_LIMIT),
          "--json",
          "number,title",
        ]),
      );
      if (json === undefined) return yield* awaited(undefined);
      const decoded = Schema.decodeOption(IssueList)(json);
      if (Option.isNone(decoded)) return yield* awaited(undefined);
      return yield* awaited(
        decoded.value.map((issue) => ({ detail: "", number: issue.number, title: issue.title })),
      );
    }),
  );
}

function gatherEnvironment(
  cwd: string,
  version: string,
): Promise<handoffRenderTypes.HandoffEnvironment> {
  return Effect.runPromise(
    awaiting(function* () {
      const [repository, state, pulls, issues] = yield* awaited(
        Promise.all([
          repositoryOf(cwd),
          Effect.runPromise(repoStates.read(cwd)),
          pullsOf(cwd),
          issuesOf(cwd),
        ]),
      );
      return yield* awaited({
        branch: state.branch === "-" ? undefined : state.branch,
        cwd,
        issues,
        pulls,
        repository,
        version,
      });
    }),
  );
}

const handoffEnvironment = {
  gatherEnvironment,
};

export default handoffEnvironment;
