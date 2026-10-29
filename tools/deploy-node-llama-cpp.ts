import { Effect, Schema } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import captureProcessModule from "./capture-process.ts";
import releasePlatforms from "./release-platforms.ts";
import type releasePlatformsTypes from "./release-platforms.types.ts";

const { processRunnerLayer, runInherit } = captureProcessModule;
const { RELEASE_PLATFORMS } = releasePlatforms;
const { runMainWith } = scriptOutput;
const { ScriptOutput } = scriptOutput;

const PAYLOAD_PACKAGE = "@msa/node-llama-cpp-payload";
const DEPLOY_LEFTOVERS: ReadonlyArray<string> = [".bin", ".modules.yaml", ".pnpm"];
const LLAMA_CPP_SOURCE_BUNDLE = ["node-llama-cpp", "llama", "gitRelease.bundle"];
const PREBUILT_SCOPE = "@node-llama-cpp";

class DeployNodeLlamaCppError extends Schema.TaggedError<
  DeployNodeLlamaCppError,
  { readonly brand: unique symbol }
>()("DeployNodeLlamaCppError", { message: Schema.String }) {}

const removeTree = (target: string) =>
  Effect.gen(function* () {
    const { files: fs } = yield* scriptOutput.ScriptOutput;
    yield* fs.remove(target);
  });

const keepOnlyPrebuilt = (platform: releasePlatformsTypes.ReleasePlatform, prebuiltsDir: string) =>
  Effect.gen(function* () {
    const { files: fs, path } = yield* scriptOutput.ScriptOutput;
    const { prebuilt } = platform.nodeLlamaCpp;
    const installed = yield* fs.readDirectory(prebuiltsDir);
    if (!installed.includes(prebuilt)) {
      return yield* DeployNodeLlamaCppError.make({
        message: `pnpm deploy did not install ${PREBUILT_SCOPE}/${prebuilt} for ${platform.name}`,
      });
    }
    for (const other of installed.filter((name) => name !== prebuilt)) {
      yield* removeTree(path.join(prebuiltsDir, other));
    }
  });

const deploy = (platform: releasePlatformsTypes.ReleasePlatform, payloadDir: string) =>
  Effect.gen(function* () {
    const { files: fs, path } = yield* scriptOutput.ScriptOutput;
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const deployDir = yield* fs.makeTempDirectoryScoped("msa-node-llama-cpp-");
    yield* runInherit({
      args: [
        "--filter",
        PAYLOAD_PACKAGE,
        "deploy",
        "--prod",
        ...platform.nodeLlamaCpp.deployFlags,
        "--config.node-linker=hoisted",
        deployDir,
      ],
      command: "pnpm",
      cwd: repoRoot,
    });
    const modulesDir = path.join(deployDir, "node_modules");
    for (const entry of [...DEPLOY_LEFTOVERS, path.join(...LLAMA_CPP_SOURCE_BUNDLE)]) {
      yield* removeTree(path.join(modulesDir, entry));
    }
    yield* keepOnlyPrebuilt(platform, path.join(modulesDir, PREBUILT_SCOPE));
    yield* (yield* ScriptOutput).copyTreeTo(modulesDir, path.join(payloadDir, "node_modules"));
  }).pipe(Effect.scoped);

const program = Effect.gen(function* () {
  const [platformName, payloadDir, ...rest] = process.argv.slice(2);
  const platform = RELEASE_PLATFORMS.find((candidate) => candidate.name === platformName);
  if (platform === undefined || payloadDir === undefined || rest.length > 0) {
    return yield* DeployNodeLlamaCppError.make({
      message: "usage: deploy-node-llama-cpp <release platform> <payload directory>",
    });
  }
  yield* deploy(platform, payloadDir);
});

runMainWith(program, processRunnerLayer);
