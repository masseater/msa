import { Effect } from "effect";

import errors from "./errors.ts";
import type runtimeTypes from "./runtime.types.ts";
import squashMessageModule from "./squash-message.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { orchestratorError } = errors;
const { squashMessageOf } = squashMessageModule;

type Verified = orchestratorTypesTypes.VerifiedPullRequest;

function merge(
  gh: (args: readonly string[]) => Effect.Effect<string, runtimeTypes.OrchestratorError>,
  number: number,
  verified: Verified,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const { head, message } = yield* squashMessageOf(
      gh,
      () => orchestratorError(new Error("gh api printed commits JSON this msa cannot read")),
      number,
      verified.title,
    );
    if (head !== verified.sha) {
      return yield* orchestratorError(
        new Error(
          `GitHub lists the commits of #${number} up to ${head ?? "none"}, not ${verified.sha}`,
        ),
      );
    }
    yield* gh([
      "pr",
      "merge",
      String(number),
      "--squash",
      "--match-head-commit",
      verified.sha,
      "--subject",
      message.subject,
      "--body",
      message.body,
    ]);
  });
}

const pullRequestSquash = { merge };

const pullRequestSquashModule = { pullRequestSquash };

export default pullRequestSquashModule;
