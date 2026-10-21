import { Console, Effect } from "effect";

import type cliOptionsTypes from "./cli-options.types.ts";
import dockerModule from "./docker.ts";
import type dockerTypes from "./docker.types.ts";
import type planTypes from "./plan.types.ts";
import platform from "./platform.ts";
import reportRead from "./report-read.ts";
import type reportTypesTypes from "./report-types.types.ts";

const { files, pathOperations } = platform;
const { buildImages, requireEvalAuthFile, runTask } = dockerModule;

const prepareDocker = (
  cli: cliOptionsTypes.EvalCliOptions & { provider: string; model: string },
  artifactDirectory: string,
): Effect.Effect<dockerTypes.DockerContext> =>
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

const runAllTasks = (
  docker: dockerTypes.DockerContext,
  tasks: readonly planTypes.EvalTask[],
): Effect.Effect<reportTypesTypes.EvalObservation[]> =>
  Effect.gen(function* () {
    const observations: reportTypesTypes.EvalObservation[] = [];
    for (const [index, task] of tasks.entries()) {
      yield* Console.log(
        `\n[${index + 1}/${tasks.length}] ${task.evalSet} > ${task.caseId} | ${task.variant} | ${task.model} | run ${task.runNumber}`,
      );
      const reportPath = yield* runTask({ context: docker, task });
      observations.push(
        reportPath === undefined
          ? reportRead.erroredObservation(task)
          : yield* reportRead.readTaskObservation({
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

const evalRunner = {
  prepareDocker,
  runAllTasks,
};

export default evalRunner;
