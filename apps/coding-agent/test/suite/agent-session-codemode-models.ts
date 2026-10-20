import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";

import extension from "../../src/extensions/codemode/extension.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createCodemodeExtension } = extension;

const { awaited, runTest } = testing;

const { TINY_PNG_BASE64, usage } = agentSessionCodemodeSupport;

const { createHarness } = harnessModule;

const harnesses4: harnessTypes.Harness[] = [];

const cleanupModelHarnesses = (): void => {
  while (harnesses4.length > 0) harnesses4.pop()?.cleanup();
};

const scorerModel: aiTypes.ClassifierModel<"test-classifier"> = {
  api: "test-classifier",
  baseUrl: "https://classifier.test/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  headers: { "X-Secret": "hunter2" },
  id: "judge",
  input: ["text"],
  name: "Judge",
  provider: "scorer",
  type: "classifier",
};

const painterModel: aiTypes.ImageModel<"test-images"> = {
  api: "test-images",
  baseUrl: "https://images.test/v1",
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "painter",
  input: ["text", "image"],
  name: "Painter",
  output: ["text", "image"],
  provider: "scorer",
  type: "image",
};

interface ClassifyObservation {
  baseUrl: string;
  apiKey: string | undefined;
  text: unknown;
}

interface ImagesObservation {
  baseUrl: string;
  apiKey: string | undefined;
  input: aiTypes.ImagesContext["input"];
}

interface Gate {
  size: number;
  opened: boolean;
  release: Deferred.Deferred<void>;
}

interface ScorerState {
  active: number;
  maxActive: number;
  gate: Gate | undefined;
  readonly observed: ClassifyObservation[];
  readonly imageRequests: ImagesObservation[];
}

const waitForTurn = Effect.fn("waitForTurn")(function* (state: ScorerState) {
  state.active++;
  state.maxActive = Math.max(state.maxActive, state.active);
  const held = state.gate;
  if (held === undefined || held.opened) {
    yield* Effect.sleep(10);
  } else if (state.active >= held.size) {
    held.opened = true;
    yield* Deferred.succeed(held.release, undefined);
  } else {
    yield* Deferred.await(held.release).pipe(Effect.timeoutOption(1000));
  }
  state.active--;
});

const classify =
  (state: ScorerState) =>
  (
    model: aiTypes.ClassifierModel<"test-classifier">,
    context: { state: Record<string, unknown> },
    options?: { apiKey?: string },
  ): Promise<aiTypes.ClassifierResult> =>
    runTest(
      Effect.gen(function* () {
        yield* waitForTurn(state);
        const text = context.state["text"];
        state.observed.push({ apiKey: options?.apiKey, baseUrl: model.baseUrl, text });
        const base = { api: model.api, model: model.id, provider: model.provider, timestamp: 0 };
        if (text === "explode") {
          return {
            ...base,
            answers: {},
            errorMessage: "classifier exploded",
            stopReason: "error" as const,
          };
        }
        return {
          ...base,
          answers: {
            approved: { probability: text === "good" ? 0.9 : 0.1, type: "bool" as const },
          },
          stopReason: "stop" as const,
          usage: usage(300, 0.001),
        };
      }),
    );

const generateImages =
  (state: ScorerState) =>
  (
    model: aiTypes.ImageModel<"test-images">,
    context: aiTypes.ImagesContext,
    options?: { apiKey?: string },
  ): Promise<aiTypes.AssistantImages> => {
    state.imageRequests.push({
      apiKey: options?.apiKey,
      baseUrl: model.baseUrl,
      input: context.input,
    });
    const prompt = context.input.find((block) => block.type === "text")?.text;
    const base = { api: model.api, model: model.id, provider: model.provider, timestamp: 0 };
    if (prompt === "explode") {
      return Promise.resolve({
        ...base,
        errorMessage: "painter exploded",
        output: [],
        stopReason: "error",
      });
    }
    return Promise.resolve({
      ...base,
      output: [
        { text: `painted ${prompt}`, type: "text" },
        { data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" },
      ],
      stopReason: "stop",
      usage: usage(100, 0.04),
    });
  };

const setup4 = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [createCodemodeExtension()],
          initialActiveToolNames: ["codemode"],
        }),
      );
      harnesses4.push(harness);
      const state: ScorerState = {
        active: 0,
        gate: undefined,
        imageRequests: [],
        maxActive: 0,
        observed: [],
      };
      harness.session.models.selection.modelRuntime.registerProvider("scorer", {
        apiKey: "secret-key",
        classifiers: { "test-classifier": { classify: classify(state) } },
        images: { "test-images": { generateImages: generateImages(state) } },
        models: [scorerModel, painterModel],
      });
      harness.session.tools.loadout.setActiveToolsByName(["codemode"]);
      return {
        harness,
        holdUntilInFlight: (size: number) => {
          state.gate = { opened: false, release: Deferred.makeUnsafe<void>(), size };
        },
        imageRequests: state.imageRequests,
        maxActive: () => state.maxActive,
        observed: state.observed,
      };
    }),
  );

const QUESTIONS = `{ approved: { type: "bool", instructions: "Approval?", criteria: { true: "yes", false: "no" } } }`;

const agentSessionCodemodeModels = {
  QUESTIONS,
  cleanupModelHarnesses,
  harnesses4,
  setup4,
};

export default agentSessionCodemodeModels;
