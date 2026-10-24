import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import localModule from "../src/providers/local.ts";
import type typesModule from "../src/types.types.ts";

const { closeServers, joinPath, listen, makeTempDir, removeDirs, runTest } = testing;
const { LIQUID_D1, localProvider } = localModule;

const FIXTURE = joinPath(import.meta.dirname, "fixtures", "stories260K.gguf");

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* closeServers;
      yield* removeDirs(directories.splice(0));
    }),
  ),
);

const modelAt = (baseUrl: string): typesModule.ClassifierModel<"node-llama-cpp-classify"> => ({
  ...LIQUID_D1,
  baseUrl,
  contextWindow: 4096,
  id: baseUrl,
});

const context: typesModule.ClassifierContext = {
  questions: {
    route: {
      criteria: { billing: "money", technical: "code" },
      instructions: "Which team should answer?",
      type: "choice",
    },
    severity: {
      criteria: ["minor", "moderate", "severe"],
      instructions: "How severe is it?",
      type: "score",
    },
  },
  state: { ticket: "The build fails after the upgrade." },
};

const tempDirectory = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-node-llama-");
  directories.push(directory);
  return directory;
});

const answersFromNextTokenProbabilities = () =>
  runTest(
    Effect.gen(function* () {
      const directory = yield* tempDirectory;
      const provider = localProvider({ directory }, [modelAt(FIXTURE)]);
      const sibling = localProvider({ directory }, [modelAt(FIXTURE)]);
      const model = modelAt(FIXTURE);

      const preparation = yield* Effect.promise(() => provider.prepareClassifier!(model));
      const first = yield* Effect.promise(() => provider.classify!(model, context));
      const second = yield* Effect.promise(() => sibling.classify!(model, context));

      expect(first.errorMessage).toBeUndefined();
      expect(first.stopReason).toBe("stop");
      const route = first.answers["route"];
      expect(route?.type).toBe("choice");
      if (route?.type !== "choice") return;
      expect(Object.keys(route.probabilities).toSorted()).toEqual(["billing", "technical"]);
      expect(route.probabilities["billing"]! + route.probabilities["technical"]!).toBeCloseTo(1);
      const severity = first.answers["severity"];
      expect(severity?.type).toBe("score");
      if (severity?.type !== "score") return;
      expect(severity.score).toBeGreaterThanOrEqual(0);
      expect(severity.score).toBeLessThanOrEqual(2);
      expect(second.answers).toEqual(first.answers);
      expect(preparation).toEqual({ fetched: false });
    }),
  );

const answersAtOnceWhileTheModelLoads = () =>
  runTest(
    Effect.gen(function* () {
      const provider = localProvider({ directory: yield* tempDirectory }, [modelAt(FIXTURE)]);
      const model = modelAt(FIXTURE);

      const loading = yield* Effect.promise(() => provider.classify!(model, context));
      yield* Effect.promise(() => provider.prepareClassifier!(model));
      const loaded = yield* Effect.promise(() => provider.classify!(model, context));

      expect(loading.stopReason).toBe("error");
      expect(loading.errorMessage).toContain(`has not loaded ${FIXTURE} yet`);
      expect(loaded.stopReason).toBe("stop");
    }),
  );

const retriesAFailedDownload = () =>
  runTest(
    Effect.gen(function* () {
      const requested: string[] = [];
      const origin = yield* listen((request) =>
        Effect.sync(() => {
          requested.push(new URL(request.url).pathname);
          return new Response("not found", { status: 404 });
        }),
      );
      const provider = localProvider(
        { directory: yield* tempDirectory, endpoints: { huggingFace: `${origin}/` } },
        [modelAt("hf:example/missing/missing.gguf")],
      );
      const model = modelAt("hf:example/missing/missing.gguf");
      const failure = Effect.tryPromise(() => provider.prepareClassifier!(model)).pipe(
        Effect.flip,
        Effect.map((error) => String(error.cause)),
      );

      const first = yield* Effect.promise(() => provider.classify!(model, context));
      const firstFailure = yield* failure;
      const requestsAfterFirst = requested.length;
      const second = yield* Effect.promise(() => provider.classify!(model, context));
      const secondFailure = yield* failure;

      expect(first.stopReason).toBe("error");
      expect(first.answers).toEqual({});
      expect(first.errorMessage).toContain("has not loaded hf:example/missing/missing.gguf yet");
      expect(second.stopReason).toBe("error");
      expect(firstFailure).not.toBe("");
      expect(secondFailure).not.toBe("");
      expect(requestsAfterFirst).toBeGreaterThan(0);
      expect(requested.length).toBeGreaterThan(requestsAfterFirst);
    }),
  );

const loadsBindingsFromTheGivenLoader = () =>
  runTest(
    Effect.gen(function* () {
      const provider = localProvider(
        {
          directory: yield* tempDirectory,
          loadBindings: () => Promise.reject(new Error("no node-llama-cpp next to the binary")),
        },
        [modelAt(FIXTURE)],
      );

      const failure = yield* Effect.tryPromise(() =>
        provider.prepareClassifier!(modelAt(FIXTURE)),
      ).pipe(Effect.flip);

      expect(String(failure.cause)).toContain("no node-llama-cpp next to the binary");
    }),
  );

describe("node-llama-cpp classifier", () => {
  it(
    "answers from the next-token probabilities of a GGUF model loaded once per process",
    answersFromNextTokenProbabilities,
  );

  it(
    "answers at once while a model already on disk is loaded into memory",
    answersAtOnceWhileTheModelLoads,
  );

  it(
    "answers at once while the model downloads, and prepares it again after a failure",
    retriesAFailedDownload,
  );

  it("loads node-llama-cpp through the configured loader", loadsBindingsFromTheGivenLoader);
});
