import nodeLlamaCppClassifyLazy from "@msa/ai/api/node-llama-cpp-classify.lazy";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import type srcTypes from "../src/index.types.ts";
import decisionModelStartup from "../src/main/decision-model-startup.ts";
import decideSupport from "./decide-support.ts";
import harnessModule from "./suite/harness.ts";

const { awaited, listen, pollUntil, readBytesFile, runTest } = testing;
const { decide } = decideModule;
const { nodeLlamaCppClassifyApi } = nodeLlamaCppClassifyLazy;
const { createHarness } = harnessModule;
const { startDecisionModel } = decisionModelStartup;
const { FIXTURE, blocking, cleanUp, tempDirectory } = decideSupport;

afterEach(() => runTest(cleanUp));

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
  const decideNow = decide(blocking(0.5)).pipe((effect) =>
    harness.session.integrations.decision.provide(effect),
  );
  return { decideNow, harness, services };
});

const startsAtStartupAndRetriesAfterAFailure = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* gatedServer;
      const { decideNow, harness, services } = yield* sessionAt(server.origin);
      try {
        const preparation = startDecisionModel(
          { appMode: "interactive", offlineMode: false },
          { services },
        );
        yield* pollUntil(
          Effect.sync(() => server.state.requests > 0),
          200,
          "20 millis",
        );
        const beforeFetch = yield* decideNow;
        yield* server.open;
        expect(preparation).toBeDefined();
        const failed = yield* Effect.promise(() => preparation!);
        server.state.serving = true;
        const afterFailure = yield* decideNow;
        yield* pollUntil(
          decideNow.pipe(Effect.map((decision) => decision.status === "decided")),
          200,
          "20 millis",
        );

        expect(beforeFetch.status).toBe("undecided");
        expect(failed).toMatchObject({ model: "fixture/stories", status: "failed" });
        expect(afterFailure.status).toBe("undecided");
      } finally {
        harness.cleanup();
      }
    }),
  );

const skipsOfflineAndPrintMode = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* gatedServer;
      const { harness, services } = yield* sessionAt(server.origin);
      try {
        const offline = startDecisionModel(
          { appMode: "interactive", offlineMode: true },
          { services },
        );
        const print = startDecisionModel({ appMode: "print", offlineMode: false }, { services });

        expect(offline).toBeUndefined();
        expect(print).toBeUndefined();
        expect(server.state.requests).toBe(0);
      } finally {
        harness.cleanup();
      }
    }),
  );

describe("decision model at startup", () => {
  it(
    "starts the download at startup, stays undecided until it lands, and retries after a failure",
    startsAtStartupAndRetriesAfterAFailure,
  );

  it("does not download offline or in print mode", skipsOfflineAndPrintMode);
});
