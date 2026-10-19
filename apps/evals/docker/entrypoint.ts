import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Data, Effect, Runtime } from "effect";

import { files, pathOperations, readEnv, runCommand } from "../src/platform.ts";
import { chownTree } from "../src/sandbox.ts";

class ChildExit extends Data.TaggedError("ChildExit")<{ readonly status: number }> {
  override readonly [Runtime.errorExitCode] = this.status;
}

const packageRoot = pathOperations.resolve(import.meta.dirname, "..");
const evalRoot = "/repo/apps/evals/evals";
const codingAgentDir = "/repo/node_modules/@msa/coding-agent";
const internalScope = "/repo/node_modules/@msa";
const authSource = "/run/msa-eval-secrets/auth.json";
const agentDir = "/tmp/msa-eval-host-agent";
const bootstrapHome = "/tmp/msa-eval-bootstrap";
const childEnvironment = {
  HOME: bootstrapHome,
  MSA_CODING_AGENT_DIR: agentDir,
  MSA_EVAL_CONTAINER: "1",
  USERPROFILE: bootstrapHome,
};
const VISIBLE_DIRECTORIES = ["docs", "examples", "src", "test", "tests"];
const VISIBLE_FILES = /^(?:readme|changelog)(?:\..+)?$/iu;

const die = (message: string): Effect.Effect<never> => Effect.die(new Error(message));

const parseId = (name: string): number => {
  const value = Number(readEnv(name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
};

const assertDirectoryEntries = (
  path: string,
  expectedEntries: readonly string[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const actual = (yield* files.readDirectory(path)).sort();
    const expected = [...expectedEntries].sort();
    if (actual.join("\n") !== expected.join("\n")) {
      return yield* die(`Unexpected eval image contents in ${path}: ${actual.join(", ")}`);
    }
  });

const assertInternalDocumentationHidden = Effect.gen(function* () {
  for (const packageName of yield* files.readDirectory(internalScope)) {
    if (packageName === "coding-agent") continue;
    const packageDirectory = pathOperations.join(internalScope, packageName);
    for (const name of yield* files.readDirectory(packageDirectory)) {
      const kind = yield* files.kind(pathOperations.join(packageDirectory, name));
      const visible =
        (kind === "directory" && VISIBLE_DIRECTORIES.includes(name)) ||
        (kind === "file" && VISIBLE_FILES.test(name));
      if (visible) {
        return yield* die(
          `Internal dependency documentation is model-visible: ${packageName}/${name}`,
        );
      }
    }
  }
});

const assertDocumentation = (variant: string | undefined): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (variant === "without_docs") {
      for (const name of ["README.md", "CHANGELOG.md", "docs", "examples"]) {
        if (yield* files.exists(pathOperations.join(codingAgentDir, name))) {
          return yield* die(`without_docs contains coding-agent ${name}.`);
        }
      }
      return;
    }
    if (variant !== "with_docs") return yield* die("Eval image has no valid MSA_EVAL_VARIANT.");
    for (const name of ["README.md", "CHANGELOG.md", "docs/models.md", "examples/README.md"]) {
      const path = pathOperations.join(codingAgentDir, name);
      if (!(yield* files.exists(path)) || (yield* files.readFileString(path)).length === 0) {
        return yield* die(`Missing documentation: ${path}`);
      }
    }
  });

const assertWorkspace = Effect.gen(function* () {
  yield* assertDirectoryEntries("/repo", ["apps", "node_modules", "package.json"]);
  yield* assertDirectoryEntries("/repo/apps", ["evals"]);
  yield* assertDirectoryEntries("/repo/apps/evals", [
    "docker",
    "evals",
    "package.json",
    "src",
    "vitest.container.config.ts",
  ]);
  for (const name of ["package.json", "dist/index.js"]) {
    if (!(yield* files.exists(pathOperations.join(codingAgentDir, name)))) {
      return yield* die(`Installed coding-agent is missing ${name}.`);
    }
  }
  yield* assertInternalDocumentationHidden;
  yield* assertDocumentation(readEnv("MSA_EVAL_VARIANT"));
});

const exitCodeOf = (command: string, args: readonly string[], cwd: string) =>
  Effect.map(runCommand(command, args, { cwd, output: "ignore" }), ({ status }) => status);

const assertRootOnly = (path: string) =>
  Effect.gen(function* () {
    const { uid, mode } = yield* files.ownership(path);
    if (uid !== 0 || (mode & 0o077) !== 0) {
      return yield* die(`Evaluator source must be readable only by root: ${path}`);
    }
  });

const probeScript = (path: string, method: string, uid: number, gid: number): string =>
  `process.setgroups([]);process.setgid(${gid});process.setuid(${uid});require("node:fs").${method}(${JSON.stringify(path)})`;

const assertSandboxCannotRead = (path: string, uid: number, gid: number) =>
  Effect.gen(function* () {
    const method = (yield* files.kind(path)) === "directory" ? "readdirSync" : "readFileSync";
    const status = yield* exitCodeOf(
      process.execPath,
      ["--eval", probeScript(path, method, uid, gid)],
      packageRoot,
    );
    if (status === 0) return yield* die(`The model-facing user can read evaluator source: ${path}`);
  });

const protectEvaluatorSources = (uid: number, gid: number) =>
  Effect.forEach(
    [
      evalRoot,
      "/repo/apps/evals/src",
      "/repo/apps/evals/docker",
      "/repo/apps/evals/vitest.container.config.ts",
    ],
    (path) => Effect.andThen(assertRootOnly(path), assertSandboxCannotRead(path, uid, gid)),
    { discard: true },
  );

const prepareAgentDirectory = (identity: { uid: number; gid: number }) =>
  Effect.gen(function* () {
    yield* files.makeDirectory(agentDir);
    if (yield* files.exists(authSource)) {
      yield* files.copyFile(authSource, pathOperations.join(agentDir, "auth.json"));
    }
    yield* chownTree(agentDir, identity);
    yield* chownTree("/artifacts", identity);
  });

const vitestArguments = (
  discover: boolean,
  vitestCli: string,
  vitestArgs: readonly string[],
): string[] =>
  discover
    ? [
        vitestCli,
        "list",
        "--config",
        "vitest.container.config.ts",
        ...vitestArgs,
        "--json=/artifacts/discovered-tests.json",
      ]
    : [
        vitestCli,
        "run",
        "--config",
        "vitest.container.config.ts",
        ...vitestArgs,
        "--reporter=vitest-evals/reporter",
        "--reporter=json",
        "--outputFile=/artifacts/vitest.json",
      ];

const runVitest = (args: readonly string[]) =>
  Effect.map(
    runCommand(process.execPath, args, {
      cwd: packageRoot,
      env: childEnvironment,
      output: "inherit",
    }),
    ({ status }) => status,
  );

const program = Effect.gen(function* () {
  const sandboxUid = parseId("MSA_EVAL_SANDBOX_UID");
  const sandboxGid = parseId("MSA_EVAL_SANDBOX_GID");
  yield* assertWorkspace;
  yield* protectEvaluatorSources(sandboxUid, sandboxGid);
  const codingAgentEntry = fileURLToPath(import.meta.resolve("@msa/coding-agent"));
  if (codingAgentEntry !== `${codingAgentDir}/dist/index.js`) {
    return yield* die(`Eval does not resolve @msa/coding-agent from dist: ${codingAgentEntry}`);
  }
  yield* prepareAgentDirectory({ uid: sandboxUid, gid: sandboxGid });
  process.umask(0o022);

  const vitestCli = pathOperations.resolve(
    pathOperations.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const inputArgs = process.argv.slice(2);
  const vitestArgs = inputArgs.filter((argument) => argument !== "--discover");
  const evalFiles = vitestArgs.filter((argument) => argument.endsWith(".eval.ts"));
  if (evalFiles.length === 0)
    return yield* die("The container runner requires an explicit eval file.");
  for (const evalFile of evalFiles) {
    yield* assertRootOnly(evalFile);
    yield* assertSandboxCannotRead(evalFile, sandboxUid, sandboxGid);
  }
  const status = yield* runVitest(
    vitestArguments(inputArgs.includes("--discover"), vitestCli, vitestArgs),
  );

  const artifactUid = readEnv("MSA_EVAL_ARTIFACT_UID");
  const artifactGid = readEnv("MSA_EVAL_ARTIFACT_GID");
  if (artifactUid !== undefined && artifactGid !== undefined) {
    yield* chownTree("/artifacts", {
      uid: parseId("MSA_EVAL_ARTIFACT_UID"),
      gid: parseId("MSA_EVAL_ARTIFACT_GID"),
    });
  }
  if (status !== 0) return yield* new ChildExit({ status });
});

NodeRuntime.runMain(program);
