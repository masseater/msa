import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Console, Data, DateTime, Effect, Schema } from "effect";

import { type EvalCliOptions, parseEvalCli } from "./cli-options.ts";
import {
  type DockerContext,
  buildImages,
  discoverCases,
  requireEvalAuthFile,
  runTask,
} from "./docker.ts";
import {
  DOCUMENTATION_VARIANTS,
  type DiscoveredEvalCase,
  type EvalTask,
  createTaskPlan,
  parseDiscoveredCases,
} from "./plan.ts";
import { files, pathOperations, randomUuid, sha256Hex } from "./platform.ts";
import { formatEvalComparisonReport } from "./report-format.ts";
import { erroredObservation, readTaskObservation } from "./report-read.ts";
import { summarizeEvalObservations } from "./report-summary.ts";
import type { EvalObservation } from "./report-types.ts";

class BlockedPairsError extends Data.TaggedError("BlockedPairsError") {}

const packageRoot = pathOperations.resolve(import.meta.dirname, "..");

const artifactRunId = Effect.gen(function* () {
  const now = yield* DateTime.now;
  return `${DateTime.formatIso(now).replaceAll(":", "-")}_${yield* randomUuid}`;
});

function containerPath(path: string): string {
  const absolute = pathOperations.resolve(packageRoot, path);
  const packageRelative = pathOperations.relative(packageRoot, absolute);
  if (packageRelative.startsWith("..")) {
    throw new Error(`Eval file must be inside ${packageRoot}: ${path}`);
  }
  return packageRelative.replaceAll("\\", "/");
}

function normalizeDiscoveredFile(path: string): string {
  const prefix = "/repo/apps/evals/";
  if (!path.startsWith(prefix)) {
    throw new Error(`Discovered eval path is outside the container package: ${path}`);
  }
  return path.slice(prefix.length);
}

const caseIdentities = (cases: readonly DiscoveredEvalCase[]): string =>
  JSON.stringify(
    cases
      .map(({ fullName, file }) => JSON.stringify([fullName, normalizeDiscoveredFile(file)]))
      .sort(),
  );

const selectFiles = (requestedFiles: readonly string[]): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const candidates =
      requestedFiles.length > 0
        ? requestedFiles
        : yield* files.glob("evals/**/*.docs.eval.ts", packageRoot);
    const selected = candidates.map(containerPath).sort();
    if (selected.length === 0) {
      return yield* Effect.die(new Error("No documentation eval files were selected."));
    }
    for (const file of selected) {
      if (!file.endsWith(".docs.eval.ts")) {
        return yield* Effect.die(
          new Error(`Documentation runner cannot execute non-doc eval: ${file}`),
        );
      }
    }
    return selected;
  });

const decodeJson = (text: string): Effect.Effect<unknown> =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.orDie);

const discoverVariant = (
  docker: DockerContext,
  variant: (typeof DOCUMENTATION_VARIANTS)[number],
  evalFiles: readonly string[],
  vitestArgs: readonly string[],
): Effect.Effect<DiscoveredEvalCase[]> =>
  Effect.gen(function* () {
    const path = yield* discoverCases({ context: docker, files: evalFiles, variant, vitestArgs });
    return parseDiscoveredCases(yield* decodeJson(yield* files.readFileString(path)));
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
  tasks: readonly EvalTask[],
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

const runAllTasks = (
  docker: DockerContext,
  tasks: readonly EvalTask[],
): Effect.Effect<EvalObservation[]> =>
  Effect.gen(function* () {
    const observations: EvalObservation[] = [];
    for (const [index, task] of tasks.entries()) {
      yield* Console.log(
        `\n[${index + 1}/${tasks.length}] ${task.evalSet} > ${task.caseId} | ${task.variant} | ${task.model} | run ${task.runNumber}`,
      );
      const reportPath = yield* runTask({ context: docker, task });
      observations.push(
        reportPath === undefined
          ? erroredObservation(task)
          : yield* readTaskObservation({
              artifactDirectory: docker.artifactDirectory,
              reportPath,
              task,
            }),
      );
      yield* files.writeFileString(
        pathOperations.resolve(docker.artifactDirectory, "observations.jsonl"),
        `${observations.map((item) => JSON.stringify(item)).join("\n")}\n`,
      );
    }
    return observations;
  });

const prepareDocker = (
  cli: EvalCliOptions & { provider: string; model: string },
  artifactDirectory: string,
): Effect.Effect<DockerContext> =>
  Effect.gen(function* () {
    const authPath = yield* requireEvalAuthFile(cli.provider);
    yield* files.makeDirectory(artifactDirectory, 0o700);
    const images = yield* buildImages;
    if (images.with_docs.id === images.without_docs.id) {
      return yield* Effect.die(new Error("Documentation variants resolved to the same image."));
    }
    return {
      artifactDirectory,
      authPath,
      images,
      model: cli.model,
      provider: cli.provider,
      runsPerVariant: cli.runsPerVariant,
    };
  });

const discoverCommonCases = (
  docker: DockerContext,
  evalFiles: readonly string[],
  vitestArgs: readonly string[],
): Effect.Effect<DiscoveredEvalCase[]> =>
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

const writeReport = (
  artifactDirectory: string,
  report: ReturnType<typeof summarizeEvalObservations>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reportText = formatEvalComparisonReport(report);
    yield* writeJson(pathOperations.resolve(artifactDirectory, "report.json"), report);
    yield* files.writeFileString(
      pathOperations.resolve(artifactDirectory, "report.txt"),
      `${reportText}\n`,
    );
    yield* Console.log(`\n${reportText}`);
    yield* Console.log(`\nArtifacts: ${artifactDirectory}`);
  });

const main = Effect.gen(function* () {
  const cli = parseEvalCli(process.argv.slice(2));
  const { provider, model } = cli;
  if (provider === undefined || model === undefined) {
    return yield* Effect.die(
      new Error("Set MSA_PROVIDER and MSA_MODEL, or pass --provider and --model."),
    );
  }
  const modelIdentity = `${provider}/${model}`;
  const evalFiles = yield* selectFiles(cli.requestedFiles);
  const artifactDirectory = pathOperations.resolve(packageRoot, ".eval", yield* artifactRunId);
  const docker = yield* prepareDocker({ ...cli, model, provider }, artifactDirectory);
  const cases = yield* discoverCommonCases(docker, evalFiles, cli.discoveryArgs);
  const tasks = createTaskPlan(cases, modelIdentity, cli.runsPerVariant);
  const protocolDigest = yield* writeProtocol(
    artifactDirectory,
    {
      cases: cases.map(({ evalSet, caseId, file }) => ({ evalSet, caseId, file })),
      files: evalFiles,
      images: docker.images,
      model: modelIdentity,
      runsPerVariant: cli.runsPerVariant,
      schemaVersion: 1,
      tasks,
    },
    tasks,
  );
  const observations = yield* runAllTasks(docker, tasks);
  const report = summarizeEvalObservations(protocolDigest, tasks, observations);
  yield* writeReport(artifactDirectory, report);
  if (report.blockedPairs.length > 0) return yield* new BlockedPairsError();
});

NodeRuntime.runMain(main);
