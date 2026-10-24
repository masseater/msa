import nodeLlamaCppClassifyLazy from "@msa/ai/api/node-llama-cpp-classify.lazy";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";

import type srcTypes from "../src/index.types.ts";
import runtimeStart from "../src/main/runtime-start.ts";
import startupModule from "../src/main/startup.ts";
import decideSupport from "./decide-support.ts";
import harnessModule from "./suite/harness.ts";

const { awaited, joinPath, listen, readBytesFile, writeJsonFile } = testing;
const { nodeLlamaCppClassifyApi } = nodeLlamaCppClassifyLazy;
const { createHarness } = harnessModule;
const { startRuntime } = runtimeStart;
const { prepareStartup } = startupModule;
const { FIXTURE, tempDirectory } = decideSupport;

const fixtureProvider =
  (directory: string, origin: string): srcTypes.ExtensionFactory =>
  (msa) => {
    msa.registerProvider("fixture", {
      apiKey: "local",
      classifiers: {
        "node-llama-cpp-classify": nodeLlamaCppClassifyApi({
          directory,
          endpoints: { huggingFace: `${origin}/` },
        }),
      },
      models: [
        {
          api: "node-llama-cpp-classify",
          baseUrl: "hf:example/fixture/stories260K.gguf",
          contextWindow: 4096,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "stories",
          input: ["text"],
          name: "Stories",
          type: "classifier",
        },
        {
          api: "openai-completions",
          baseUrl: `${origin}/v1`,
          contextWindow: 4096,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "chat",
          input: ["text"],
          maxTokens: 1024,
          name: "Chat",
          reasoning: false,
        },
      ],
    });
  };

const gatedServer = Effect.gen(function* () {
  const bytes = yield* readBytesFile(FIXTURE);
  const gate = yield* Deferred.make<void>();
  const state = { requests: 0, serving: false };
  const model = new Response(bytes, {
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": "application/octet-stream",
    },
  });
  const origin = yield* listen(() =>
    Effect.sync(() => {
      state.requests += 1;
    }).pipe(
      Effect.andThen(Deferred.await(gate)),
      Effect.map(() =>
        state.serving ? model.clone() : new Response("not found", { status: 404 }),
      ),
    ),
  );
  return { open: Deferred.succeed(gate, undefined), origin, state };
});

const sessionAt = Effect.fn("sessionAt")(function* (origin: string) {
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [fixtureProvider(yield* tempDirectory, origin)],
      settings: { decision: { model: "fixture/stories" } },
    }),
  );
  const services = {
    modelRuntime: harness.session.models.selection.modelRuntimeInternal,
    settingsManager: harness.settingsManager,
  };
  return { harness, services };
});

const startedRpc = Effect.fn("startedRpc")(function* (origin: string) {
  const agentDir = yield* tempDirectory;
  yield* writeJsonFile(joinPath(agentDir, "settings.json"), {
    decision: { model: "fixture/stories" },
  });
  const boot = {
    agentDir,
    cwd: yield* tempDirectory,
    extensionFactories: [fixtureProvider(yield* tempDirectory, origin)],
    offlineMode: false,
  };
  const startup = yield* awaited(prepareStartup(["--mode", "rpc", "--no-session"], boot));
  const runtime = yield* awaited(startRuntime(startup));
  return { runtime, startup };
});

const decisionModelStartupSupport = { gatedServer, sessionAt, startedRpc };

export default decisionModelStartupSupport;
