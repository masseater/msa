import { Effect, Option } from "effect";
import * as Schema from "effect/Schema";

import platformCrypto from "../platform/crypto.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import squashMessageModule from "./squash-message.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { squashMessageAt } = squashMessageModule;

type Verified = orchestratorTypesTypes.VerifiedPullRequest;
type MergeAttempt = orchestratorTypesTypes.MergeAttempt;
type GhResult = orchestratorTypes.GhResult;
type Gh = (args: readonly string[]) => Effect.Effect<GhResult>;

interface SquashMessage {
  subject: string;
  body: string;
}

interface HarnessMerge {
  nonce: string;
  squashed: SquashMessage;
}

const TRAILER = "Msa-Merge";

const MergeAnswer = Schema.fromJsonString(
  Schema.Struct({ merged: Schema.Boolean, sha: Schema.String }),
);

const CommitAnswer = Schema.fromJsonString(
  Schema.Struct({ commit: Schema.Struct({ message: Schema.String }) }),
);

const HTTP_REFUSAL = /\(HTTP 4\d\d\)/u;

function ghWith(
  runGh: (args: readonly string[], cwd: string) => Promise<GhResult>,
  cwd: string,
): Gh {
  return (args) =>
    Effect.promise(() =>
      runGh(args, cwd).catch((error: unknown) => ({ code: 1, stderr: String(error), stdout: "" })),
    );
}

function ghOf(runtime: runtimeTypes.Runtime, cwd: string): Gh {
  return ghWith(runtime.options.runGh, cwd);
}

function stdoutOf(gh: Gh): (args: readonly string[]) => Effect.Effect<string, string> {
  return (args) =>
    Effect.flatMap(gh(args), (result) =>
      result.code === 0
        ? Effect.succeed(result.stdout)
        : Effect.fail(`gh api: ${(result.stderr || result.stdout).trim()}`),
    );
}

function trailerOf(nonce: string): string {
  return `${TRAILER}: ${nonce}`;
}

function withTrailer(squashed: SquashMessage, nonce: string): SquashMessage {
  const trailer = trailerOf(nonce);
  return { ...squashed, body: squashed.body === "" ? trailer : `${squashed.body}\n\n${trailer}` };
}

function carriesNonce(text: string, nonce: string): boolean {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .some((line) => line.trim() === trailerOf(nonce));
}

function mergeArgs(number: number, head: string, squashed: SquashMessage): readonly string[] {
  return [
    "api",
    "--method",
    "PUT",
    `repos/{owner}/{repo}/pulls/${number}/merge`,
    "-f",
    "merge_method=squash",
    "-f",
    `sha=${head}`,
    "-f",
    `commit_title=${squashed.subject}`,
    "-f",
    `commit_message=${squashed.body}`,
  ];
}

function attemptOf(result: GhResult): MergeAttempt {
  const said = (result.stderr || result.stdout).trim();
  if (result.code !== 0) {
    return HTTP_REFUSAL.test(said)
      ? { kind: "refused", why: `GitHub refused the merge: ${said}` }
      : { kind: "unanswered", why: `gh api ended without GitHub's answer: ${said}` };
  }
  const answer = Option.getOrUndefined(Schema.decodeOption(MergeAnswer)(result.stdout));
  if (answer?.merged === true && answer.sha !== "") return { commit: answer.sha, kind: "merged" };
  return {
    kind: "unanswered",
    why: `gh api printed no merge commit: ${result.stdout.trim() || "(nothing)"}`,
  };
}

function prepare(
  gh: Gh,
  number: number,
  verified: Pick<Verified, "sha" | "title">,
): Effect.Effect<HarnessMerge, string> {
  return Effect.gen(function* () {
    const nonce = platformCrypto.randomUuid();
    const squashed = yield* squashMessageAt(
      stdoutOf(gh),
      (reason) => reason,
      number,
      verified.title,
      verified.sha,
    );
    return { nonce, squashed: withTrailer(squashed, nonce) };
  });
}

function merge(
  gh: Gh,
  number: number,
  head: string,
  squashed: SquashMessage,
): Effect.Effect<MergeAttempt> {
  return Effect.map(gh(mergeArgs(number, head, squashed)), attemptOf);
}

function commitMessage(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  commit: string,
): Effect.Effect<string, string> {
  return Effect.flatMap(
    stdoutOf(ghOf(runtime, cwd))(["api", `repos/{owner}/{repo}/commits/${commit}`]),
    (json) =>
      Option.match(Schema.decodeOption(CommitAnswer)(json), {
        onNone: () => Effect.fail(`gh api printed commit JSON that cannot be read: ${json.trim()}`),
        onSome: (answer) => Effect.succeed(answer.commit.message),
      }),
  );
}

const pullRequestSquash = {
  carriesNonce,
  commitMessage,
  ghOf,
  ghWith,
  merge,
  prepare,
  trailerOf,
  withTrailer,
};

const pullRequestSquashModule = { pullRequestSquash };

export default pullRequestSquashModule;
