import { Effect, Option, Result } from "effect";
import * as Schema from "effect/Schema";

import type orchestratorTypes from "./orchestrator.types.ts";
import squashMessageModule from "./squash-message.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { mergeArgs, squashMessageAt } = squashMessageModule;

type Verified = orchestratorTypesTypes.VerifiedPullRequest;
type MergeAttempt = orchestratorTypesTypes.MergeAttempt;
type GhResult = orchestratorTypes.GhResult;

const MergeAnswer = Schema.fromJsonString(
  Schema.Struct({ merged: Schema.Boolean, sha: Schema.String }),
);

const HTTP_REFUSAL = /\(HTTP 4\d\d\)/u;

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

function merge(
  gh: (args: readonly string[]) => Effect.Effect<GhResult>,
  number: number,
  verified: Verified,
): Effect.Effect<MergeAttempt> {
  return Effect.gen(function* () {
    const message = yield* Effect.result(
      squashMessageAt(
        (args) =>
          Effect.flatMap(gh(args), (result) =>
            result.code === 0
              ? Effect.succeed(result.stdout)
              : Effect.fail(`gh api: ${(result.stderr || result.stdout).trim()}`),
          ),
        (reason) => reason,
        number,
        verified.title,
        verified.sha,
      ),
    );
    if (Result.isFailure(message)) return { kind: "refused", why: message.failure };
    return attemptOf(yield* gh(mergeArgs(number, verified.sha, message.success)));
  });
}

const pullRequestSquash = { merge };

const pullRequestSquashModule = { pullRequestSquash };

export default pullRequestSquashModule;
