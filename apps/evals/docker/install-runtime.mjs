import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Schema } from "effect";

import { codingAgentName } from "../../../scripts/coding-agent-smoke.ts";
import { installConsumer } from "../../../scripts/local-package-install.mjs";
import { produceArtifactSet } from "../../../scripts/package-artifacts.mjs";
import { files, pathOperations, runCommand } from "../src/platform.ts";

const repositoryRoot = pathOperations.resolve(import.meta.dirname, "../../..");
const VISIBLE_DIRECTORIES = ["docs", "examples", "src", "test", "tests"];
const VISIBLE_FILES = /^(?:readme|changelog)(?:\..+)?$/iu;

const EvalPackage = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    devDependencies: Schema.Record(Schema.String, Schema.String),
  }),
);

const die = (message) => Effect.die(new Error(message));

const removeModelVisibleFiles = (installDirectory, artifactNames) =>
  Effect.forEach(
    [...artifactNames].filter((packageName) => packageName !== codingAgentName),
    (packageName) =>
      Effect.gen(function* () {
        const packageDirectory = pathOperations.join(
          installDirectory,
          "node_modules",
          ...packageName.split("/"),
        );
        if (!(yield* files.exists(packageDirectory))) return;
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
      }),
    { discard: true },
  );

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

const program = Effect.gen(function* () {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined || outputDirectory === "" || process.argv.length !== 3) {
    return yield* die("Usage: node apps/evals/docker/install-runtime.mjs <output-directory>");
  }
  const evalPackage = yield* Schema.decodeEffect(EvalPackage)(
    yield* files.readFileString(pathOperations.join(repositoryRoot, "apps/evals/package.json")),
  ).pipe(Effect.orDie);
  const artifactSet = produceArtifactSet({
    build: false,
    outDir: pathOperations.join(outputDirectory, "artifacts"),
    repoRoot: repositoryRoot,
    source: null,
  });
  const artifactNames = new Set(artifactSet.packages.map((pkg) => pkg.name));
  const evaluatorDependencies = Object.entries({
    ...evalPackage.dependencies,
    ...evalPackage.devDependencies,
  }).filter(([name]) => !artifactNames.has(name));
  const installDirectory = pathOperations.join(outputDirectory, "install");
  installConsumer({ artifactSet, directory: installDirectory, packageNames: [codingAgentName] });
  const { status } = yield* runCommand(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-save",
      ...evaluatorDependencies.map(([name, version]) => `${name}@${version}`),
    ],
    { cwd: installDirectory, output: "inherit" },
  );
  if (status !== 0) return yield* die(`npm install exited with status ${status}.`);
  yield* removeModelVisibleFiles(installDirectory, artifactNames);
  yield* stageRuntime(outputDirectory);
});

NodeRuntime.runMain(program);
