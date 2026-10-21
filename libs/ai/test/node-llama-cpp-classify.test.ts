import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type nodeLlamaCppClassifyTypes from "../src/api/node-llama-cpp-classify.types.ts";
import localModule from "../src/providers/local.ts";
import type typesModule from "../src/types.types.ts";

const { closeServers, joinPath, listen, makeTempDir, pollUntil, removeDirs, runTest } = testing;
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
      const events: nodeLlamaCppClassifyTypes.LocalModelEvent[] = [];
      const directory = yield* tempDirectory;
      const provider = localProvider({ directory, onEvent: (event) => events.push(event) }, [
        modelAt(FIXTURE),
      ]);
      const sibling = localProvider({ directory, onEvent: (event) => events.push(event) }, [
        modelAt(FIXTURE),
      ]);
      const model = modelAt(FIXTURE);

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
      expect(events).toEqual([{ path: FIXTURE, type: "ready", uri: FIXTURE }]);
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
      const events: nodeLlamaCppClassifyTypes.LocalModelEvent[] = [];
      const provider = localProvider(
        {
          directory: yield* tempDirectory,
          endpoints: { huggingFace: `${origin}/` },
          onEvent: (event) => events.push(event),
        },
        [modelAt("hf:example/missing/missing.gguf")],
      );
      const model = modelAt("hf:example/missing/missing.gguf");

      const failures = Effect.sync(() => events.filter((event) => event.type === "failed").length);

      const first = yield* Effect.promise(() => provider.classify!(model, context));
      yield* pollUntil(
        Effect.map(failures, (count) => count === 1),
        100,
        "20 millis",
      );
      const requestsAfterFirst = requested.length;
      const second = yield* Effect.promise(() => provider.classify!(model, context));
      yield* pollUntil(
        Effect.map(failures, (count) => count === 2),
        100,
        "20 millis",
      );

      expect(first.stopReason).toBe("error");
      expect(first.answers).toEqual({});
      expect(first.errorMessage).toContain("still fetching hf:example/missing/missing.gguf");
      expect(second.stopReason).toBe("error");
      expect(requestsAfterFirst).toBeGreaterThan(0);
      expect(requested.length).toBeGreaterThan(requestsAfterFirst);
      expect(
        events.map((event) => event.type).filter((type) => type !== "download-progress"),
      ).toEqual(["download-started", "failed", "download-started", "failed"]);
    }),
  );

describe("node-llama-cpp classifier", () => {
  it(
    "answers from the next-token probabilities of a GGUF model loaded once per process",
    answersFromNextTokenProbabilities,
  );

  it(
    "answers at once while the model downloads, and downloads again after a failure",
    retriesAFailedDownload,
  );
});
