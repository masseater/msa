import { Effect } from "effect";

import errors from "./errors.ts";
import type runtimeTypes from "./runtime.types.ts";
import squashMessageModule from "./squash-message.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { orchestratorError } = errors;
const { mergeArgs, squashMessageAt } = squashMessageModule;

type Verified = orchestratorTypesTypes.VerifiedPullRequest;

function merge(
  gh: (args: readonly string[]) => Effect.Effect<string, runtimeTypes.OrchestratorError>,
  number: number,
  verified: Verified,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const message = yield* squashMessageAt(
      gh,
      (reason) => orchestratorError(new Error(reason)),
      number,
      verified.title,
      verified.sha,
    );
    yield* gh(mergeArgs(number, verified.sha, message));
  });
}

const pullRequestSquash = { merge };

const pullRequestSquashModule = { pullRequestSquash };

export default pullRequestSquashModule;
