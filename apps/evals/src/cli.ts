import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Data, Effect } from "effect";

import caseDiscovery from "./case-discovery.ts";
import cliOptions from "./cli-options.ts";
import evalRunner from "./eval-runner.ts";
import plan from "./plan.ts";
import platform from "./platform.ts";
import reportSummary from "./report-summary.ts";
import runArtifacts from "./run-artifacts.ts";

const { files, pathOperations } = platform;

class BlockedPairsError extends Data.TaggedError("BlockedPairsError") {}

const packageRoot = pathOperations.resolve(import.meta.dirname, "..");

function containerPath(path: string): string {
  const absolute = pathOperations.resolve(packageRoot, path);
  const packageRelative = pathOperations.relative(packageRoot, absolute);
  if (packageRelative.startsWith("..")) {
    throw new Error(`Eval file must be inside ${packageRoot}: ${path}`);
  }
  return packageRelative.replaceAll("\\", "/");
}

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

const main = Effect.gen(function* () {
  const cli = cliOptions.parseEvalCli(process.argv.slice(2));
  const { provider, model } = cli;
  if (provider === undefined || model === undefined) {
    return yield* Effect.die(
      new Error("Set MSA_PROVIDER and MSA_MODEL, or pass --provider and --model."),
    );
  }
  const modelIdentity = `${provider}/${model}`;
  const evalFiles = yield* selectFiles(cli.requestedFiles);
  const artifactDirectory = pathOperations.resolve(
    packageRoot,
    ".eval",
    yield* runArtifacts.artifactRunId,
  );
  const docker = yield* evalRunner.prepareDocker({ ...cli, model, provider }, artifactDirectory);
  const cases = yield* caseDiscovery.discoverCommonCases(docker, evalFiles, cli.discoveryArgs);
  const tasks = plan.createTaskPlan(cases, modelIdentity, cli.runsPerVariant);
  const protocolDigest = yield* runArtifacts.writeProtocol(
    artifactDirectory,
    {
      cases: cases.map(({ evalSet, caseId, file }) => ({ caseId, evalSet, file })),
      files: evalFiles,
      images: docker.images,
      model: modelIdentity,
      runsPerVariant: cli.runsPerVariant,
      schemaVersion: 1,
      tasks,
    },
    tasks,
  );
  const observations = yield* evalRunner.runAllTasks(docker, tasks);
  const report = reportSummary.summarizeEvalObservations(protocolDigest, tasks, observations);
  yield* runArtifacts.writeReport(artifactDirectory, report);
  if (report.blockedPairs.length > 0) return yield* new BlockedPairsError();
});

NodeRuntime.runMain(main);
