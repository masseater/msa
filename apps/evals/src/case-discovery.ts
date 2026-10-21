import { Effect, Schema } from "effect";

import dockerModule from "./docker.ts";
import type dockerTypes from "./docker.types.ts";
import plan from "./plan.ts";
import type planTypes from "./plan.types.ts";
import platform from "./platform.ts";

const { DOCUMENTATION_VARIANTS, parseDiscoveredCases } = plan;

const CONTAINER_PACKAGE_PREFIX = "/repo/apps/evals/";

function normalizeDiscoveredFile(path: string): string {
  if (!path.startsWith(CONTAINER_PACKAGE_PREFIX)) {
    throw new Error(`Discovered eval path is outside the container package: ${path}`);
  }
  return path.slice(CONTAINER_PACKAGE_PREFIX.length);
}

const caseIdentities = (cases: readonly planTypes.DiscoveredEvalCase[]): string =>
  JSON.stringify(
    cases
      .map(({ fullName, file }) => JSON.stringify([fullName, normalizeDiscoveredFile(file)]))
      .sort(),
  );

const decodeJson = (text: string): Effect.Effect<unknown> =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.orDie);

const discoverVariant = (
  docker: dockerTypes.DockerContext,
  variant: (typeof DOCUMENTATION_VARIANTS)[number],
  evalFiles: readonly string[],
  vitestArgs: readonly string[],
): Effect.Effect<planTypes.DiscoveredEvalCase[]> =>
  Effect.gen(function* () {
    const path = yield* dockerModule.discoverCases({
      context: docker,
      files: evalFiles,
      variant,
      vitestArgs,
    });
    return parseDiscoveredCases(yield* decodeJson(yield* platform.files.readFileString(path)));
  });

const discoverCommonCases = (
  docker: dockerTypes.DockerContext,
  evalFiles: readonly string[],
  vitestArgs: readonly string[],
): Effect.Effect<planTypes.DiscoveredEvalCase[]> =>
  Effect.gen(function* () {
    const [firstVariant, secondVariant] = DOCUMENTATION_VARIANTS;
    const first = yield* discoverVariant(docker, firstVariant, evalFiles, vitestArgs);
    const second = yield* discoverVariant(docker, secondVariant, evalFiles, vitestArgs);
    if (caseIdentities(first) !== caseIdentities(second)) {
      return yield* Effect.die(
        new Error("Documentation variants discovered different eval cases."),
      );
    }
    const cases = first.map(({ fullName, evalSet, caseId, file }) => ({
      caseId,
      evalSet,
      file: normalizeDiscoveredFile(file),
      fullName,
    }));
    if (cases.length === 0) {
      return yield* Effect.die(new Error("No documentation eval cases matched the selection."));
    }
    return cases;
  });

const caseDiscovery = {
  discoverCommonCases,
};

export default caseDiscovery;
