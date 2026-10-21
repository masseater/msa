import { Console, DateTime, Effect, Schema } from "effect";

import type planTypes from "./plan.types.ts";
import platform from "./platform.ts";
import reportFormat from "./report-format.ts";
import type reportSummary from "./report-summary.ts";

const { files, pathOperations, randomUuid, sha256Hex } = platform;

type EvalReport = ReturnType<typeof reportSummary.summarizeEvalObservations>;

const artifactRunId = Effect.gen(function* () {
  const now = yield* DateTime.now;
  return `${DateTime.formatIso(now).replaceAll(":", "-")}_${yield* randomUuid}`;
});

const encodeCompact = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const encodePretty = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

const writeJson = (path: string, value: unknown): Effect.Effect<void> =>
  Effect.flatMap(Effect.orDie(encodePretty(value)), (text) =>
    files.writeFileString(path, `${text}\n`),
  );

const writeProtocol = (
  artifactDirectory: string,
  protocol: Record<string, unknown>,
  tasks: readonly planTypes.EvalTask[],
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const protocolDigest = yield* Effect.flatMap(Effect.orDie(encodeCompact(protocol)), sha256Hex);
    yield* writeJson(pathOperations.resolve(artifactDirectory, "protocol.json"), {
      ...protocol,
      protocolDigest,
    });
    yield* writeJson(pathOperations.resolve(artifactDirectory, "expected-runs.json"), tasks);
    return protocolDigest;
  });

const writeReport = (artifactDirectory: string, report: EvalReport): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reportText = reportFormat.formatEvalComparisonReport(report);
    yield* writeJson(pathOperations.resolve(artifactDirectory, "report.json"), report);
    yield* files.writeFileString(
      pathOperations.resolve(artifactDirectory, "report.txt"),
      `${reportText}\n`,
    );
    yield* Console.log(`\n${reportText}`);
    yield* Console.log(`\nArtifacts: ${artifactDirectory}`);
  });

const runArtifacts = {
  artifactRunId,
  writeProtocol,
  writeReport,
};

export default runArtifacts;
