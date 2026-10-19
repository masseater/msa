import { homedir } from "node:os";

import { Effect, Schema } from "effect";

import type { DocumentationVariant, EvalTask } from "./plan.ts";
import { files, pathOperations, readEnv, runCommand, sha256Hex } from "./platform.ts";

const packageRoot = pathOperations.resolve(import.meta.dirname, "..");
const repositoryRoot = pathOperations.resolve(packageRoot, "../..");

export type BuiltImages = Record<DocumentationVariant, { name: string; id: string }>;

export type DockerContext = {
  images: BuiltImages;
  artifactDirectory: string;
  authPath: string;
  provider: string;
  model: string;
  runsPerVariant: number;
};

const execute = (command: string, args: readonly string[], capture: boolean) =>
  runCommand(command, args, { cwd: packageRoot, output: capture ? "capture" : "inherit" });

const requireSuccess = (command: string, args: readonly string[]): Effect.Effect<void> =>
  Effect.flatMap(execute(command, args, false), ({ status }) =>
    status === 0 ? Effect.void : Effect.die(new Error(`${command} exited with status ${status}.`)),
  );

const buildImage = (
  variant: DocumentationVariant,
  name: string,
): Effect.Effect<{ name: string; id: string }> =>
  Effect.gen(function* () {
    yield* requireSuccess("docker", [
      "build",
      "--target",
      variant,
      "--tag",
      name,
      "--file",
      pathOperations.join(packageRoot, "docker", "Dockerfile"),
      repositoryRoot,
    ]);
    const inspected = yield* execute(
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", name],
      true,
    );
    const id = inspected.stdout.trim();
    if (inspected.status !== 0 || id === "") {
      return yield* Effect.die(new Error(`Cannot inspect ${name}.`));
    }
    return { name, id };
  });

export const buildImages: Effect.Effect<BuiltImages> = Effect.gen(function* () {
  const digest = yield* sha256Hex(repositoryRoot);
  const prefix = `msa-evals-${digest.slice(0, 12)}`;
  const withoutDocs = yield* buildImage("without_docs", `${prefix}-without-docs:local`);
  const withDocs = yield* buildImage("with_docs", `${prefix}-with-docs:local`);
  return { without_docs: withoutDocs, with_docs: withDocs };
});

const environment = (name: string, value: string): string[] => ["--env", `${name}=${value}`];

const decodeCredentials = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export const requireEvalAuthFile = (provider: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const configuredDirectory = readEnv("MSA_CODING_AGENT_DIR");
    const directory =
      configuredDirectory === undefined || configuredDirectory === ""
        ? pathOperations.join(homedir(), ".msa", "agent")
        : pathOperations.resolve(configuredDirectory);
    const path = pathOperations.join(directory, "auth.json");
    if (!(yield* files.exists(path))) {
      return yield* Effect.die(new Error(`Eval authentication file does not exist: ${path}`));
    }
    const credentials = yield* decodeCredentials(yield* files.readFileString(path)).pipe(
      Effect.mapError(
        (error) => new Error(`Eval authentication file is invalid: ${path}`, { cause: error }),
      ),
      Effect.orDie,
    );
    if (!Object.hasOwn(credentials, provider)) {
      return yield* Effect.die(
        new Error(`Eval authentication file has no credential for provider ${provider}.`),
      );
    }
    return path;
  });

const dockerArgs = ({
  context,
  variant,
  outputDirectory,
  entrypointArgs,
}: {
  context: DockerContext;
  variant: DocumentationVariant;
  outputDirectory: string;
  entrypointArgs: readonly string[];
}): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    yield* files.makeDirectory(outputDirectory, 0o700);
    const args = [
      "run",
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,mode=1777",
      "--tmpfs",
      "/repo/node_modules/.vite-temp:rw,exec,mode=1777",
      "--mount",
      `type=bind,source=${outputDirectory},target=/artifacts`,
      ...environment("MSA_EVAL_ARTIFACT_DIR", "/artifacts"),
      ...environment("MSA_EVAL_RUNS_PER_VARIANT", String(context.runsPerVariant)),
      ...environment("MSA_EVAL_SANDBOX_UID", "65532"),
      ...environment("MSA_EVAL_SANDBOX_GID", "65532"),
      ...environment("MSA_PROVIDER", context.provider),
      ...environment("MSA_MODEL", context.model),
    ];
    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      args.push(
        ...environment("MSA_EVAL_ARTIFACT_UID", String(process.getuid())),
        ...environment("MSA_EVAL_ARTIFACT_GID", String(process.getgid())),
      );
    }
    args.push(
      "--mount",
      `type=bind,source=${context.authPath},target=/run/msa-eval-secrets/auth.json,readonly`,
      context.images[variant].name,
      ...entrypointArgs,
    );
    return args;
  });

export const discoverCases = ({
  context,
  variant,
  files: evalFiles,
  vitestArgs,
}: {
  context: DockerContext;
  variant: DocumentationVariant;
  files: readonly string[];
  vitestArgs: readonly string[];
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    const outputDirectory = pathOperations.join(context.artifactDirectory, "discovery", variant);
    const args = yield* dockerArgs({
      context,
      variant,
      outputDirectory,
      entrypointArgs: ["--discover", "--project", "docs", ...evalFiles, ...vitestArgs],
    });
    const { status } = yield* execute("docker", args, false);
    if (status !== 0) return yield* Effect.die(new Error(`${variant} eval discovery failed.`));
    return pathOperations.join(outputDirectory, "discovered-tests.json");
  });

const taskDirectoryName = (task: EvalTask): Effect.Effect<string> =>
  sha256Hex(JSON.stringify([task.evalSet, task.caseId, task.variant, task.model, task.runNumber]));

export const runTask = ({
  context,
  task,
}: {
  context: DockerContext;
  task: EvalTask;
}): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const outputDirectory = pathOperations.join(
      context.artifactDirectory,
      "tasks",
      yield* taskDirectoryName(task),
    );
    const exactName = `(?:^| )${task.caseId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;
    const args = yield* dockerArgs({
      context,
      variant: task.variant,
      outputDirectory,
      entrypointArgs: ["--project", "docs", task.file, "--testNamePattern", exactName],
    });
    yield* execute("docker", args, false);
    const reportPath = pathOperations.join(outputDirectory, "vitest.json");
    return (yield* files.exists(reportPath)) ? reportPath : undefined;
  });
