import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect } from "effect";

import { files, pathOperations, runCommand } from "../src/platform.ts";

const codingAgentName = "@msa/coding-agent";
const repositoryRoot = pathOperations.resolve(import.meta.dirname, "../../..");
const codingAgentEntry = pathOperations.basename(codingAgentName);
const VISIBLE_DIRECTORIES = ["docs", "examples", "src", "test", "tests"];
const VISIBLE_FILES = /^(?:readme|changelog)(?:\..+)?$/iu;

const die = (message) => Effect.die(new Error(message));

const removeModelVisibleFiles = (installDirectory) =>
  Effect.gen(function* () {
    const scope = pathOperations.join(installDirectory, "node_modules", "@msa");
    if (!(yield* files.exists(scope))) return;
    for (const packageName of yield* files.readDirectory(scope)) {
      if (packageName === codingAgentEntry) continue;
      const packageDirectory = pathOperations.join(scope, packageName);
      if ((yield* files.kind(packageDirectory)) !== "directory") continue;
      for (const name of yield* files.readDirectory(packageDirectory)) {
        const path = pathOperations.join(packageDirectory, name);
        const kind = yield* files.kind(path);
        if (
          (kind === "directory" && VISIBLE_DIRECTORIES.includes(name)) ||
          (kind === "file" && VISIBLE_FILES.test(name))
        ) {
          yield* files.remove(path);
        }
      }
    }
  });

const stageRuntime = (outputDirectory) =>
  Effect.gen(function* () {
    const runtimeRoot = pathOperations.join(outputDirectory, "root");
    const runtimeEvalRoot = pathOperations.join(runtimeRoot, "apps/evals");
    yield* files.makeDirectory(pathOperations.join(runtimeEvalRoot, "docker"));
    yield* files.copy(
      pathOperations.join(repositoryRoot, "package.json"),
      pathOperations.join(runtimeRoot, "package.json"),
    );
    for (const file of ["package.json", "vitest.container.config.ts"]) {
      yield* files.copy(
        pathOperations.join(repositoryRoot, "apps/evals", file),
        pathOperations.join(runtimeEvalRoot, file),
      );
    }
    for (const directory of ["src", "evals"]) {
      yield* files.copy(
        pathOperations.join(repositoryRoot, "apps/evals", directory),
        pathOperations.join(runtimeEvalRoot, directory),
      );
    }
    yield* files.copy(
      pathOperations.join(repositoryRoot, "apps/evals/docker/entrypoint.ts"),
      pathOperations.join(runtimeEvalRoot, "docker/entrypoint.ts"),
    );
  });

const deployRuntime = (installDirectory) =>
  Effect.gen(function* () {
    const { status } = yield* runCommand(
      "pnpm",
      [
        "--filter",
        "@msa/evals",
        "deploy",
        "--legacy",
        "--config.node-linker=hoisted",
        "--ignore-scripts",
        installDirectory,
      ],
      { cwd: repositoryRoot, output: "inherit" },
    );
    if (status !== 0) return yield* die(`pnpm deploy exited with status ${status}.`);
  });

const program = Effect.gen(function* () {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined || outputDirectory === "" || process.argv.length !== 3) {
    return yield* die("Usage: node apps/evals/docker/install-runtime.mjs <output-directory>");
  }
  const installDirectory = pathOperations.join(outputDirectory, "install");
  yield* files.makeDirectory(installDirectory);
  yield* deployRuntime(installDirectory);
  yield* removeModelVisibleFiles(installDirectory);
  yield* stageRuntime(outputDirectory);
});

NodeRuntime.runMain(program);
