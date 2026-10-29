import testing from "@msa/testing";
import { Effect } from "effect";
import type {
  Llama,
  LlamaContext,
  LlamaContextSequence,
  LlamaModel,
  LlamaOptions,
} from "node-llama-cpp";
import { afterEach, describe, expect, it } from "vite-plus/test";

import localModule from "../src/providers/local.ts";
import type typesModule from "../src/types.types.ts";

const { joinPath, localLlmTests, makeTempDir, removeDirs, runTest } = testing;
const { LIQUID_D1, localProvider } = localModule;

const ATTENTION_FIXTURE = joinPath(import.meta.dirname, "fixtures", "stories260K.gguf");
const RECURRENT_FIXTURE = joinPath(import.meta.dirname, "fixtures", "tiny-mamba-random.gguf");

type Bindings = typeof import("node-llama-cpp");

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const modelAt = (baseUrl: string): typesModule.ClassifierModel<"node-llama-cpp-classify"> => ({
  ...LIQUID_D1,
  baseUrl,
  contextWindow: 4096,
  id: baseUrl,
});

const QUESTIONS: typesModule.ClassifierContext["questions"] = {
  area: {
    criteria: { build: "the build", docs: "the documentation", runtime: "the running program" },
    instructions: "Which area does the ticket concern?",
    type: "choice",
  },
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
};

const ticket = (subject: string): typesModule.JsonObject => ({
  ticket: `${subject} ${"The build fails after the upgrade and the log repeats the same line. ".repeat(12)}`,
});

const rounded = (value: unknown): unknown => {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
};

function meterSequences(context: LlamaContext, sequences: LlamaContextSequence[]): LlamaContext {
  const getSequence = context.getSequence.bind(context);
  context.getSequence = (options) => {
    const sequence = getSequence(options);
    sequences.push(sequence);
    return sequence;
  };
  return context;
}

function meterContexts(model: LlamaModel, sequences: LlamaContextSequence[]): LlamaModel {
  const createContext = model.createContext.bind(model);
  model.createContext = (options) =>
    Effect.runPromise(
      Effect.map(
        Effect.promise(() => createContext(options)),
        (context) => meterSequences(context, sequences),
      ),
    );
  return model;
}

function meterModels(llama: Llama, sequences: LlamaContextSequence[]): Llama {
  const loadModel = llama.loadModel.bind(llama);
  llama.loadModel = (options) =>
    Effect.runPromise(
      Effect.map(
        Effect.promise(() => loadModel(options)),
        (model) => meterContexts(model, sequences),
      ),
    );
  return llama;
}

const meteredBindings = (sequences: LlamaContextSequence[]) => (): Promise<Bindings> =>
  Effect.runPromise(
    Effect.map(
      Effect.promise((): Promise<Bindings> => import("node-llama-cpp")),
      (bindings): Bindings => ({
        ...bindings,
        getLlama: ((options?: LlamaOptions) =>
          Effect.runPromise(
            Effect.map(
              Effect.promise(() => bindings.getLlama(options)),
              (llama) => meterModels(llama, sequences),
            ),
          )) as Bindings["getLlama"],
      }),
    ),
  );

const classifyMetered = (fixture: string, contexts: readonly typesModule.ClassifierContext[]) =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir("msa-node-llama-prefix-");
    directories.push(directory);
    const sequences: LlamaContextSequence[] = [];
    const model = modelAt(fixture);
    const provider = localProvider({ directory, loadBindings: meteredBindings(sequences) }, [
      model,
    ]);
    yield* Effect.promise(() => provider.prepareClassifier!(model));
    const results: Array<{ answers: typesModule.ClassifierResult["answers"]; evaluated: number }> =
      [];
    for (const context of contexts) {
      const before = sequences[0]!.tokenMeter.usedInputTokens;
      const result = yield* Effect.promise(() => provider.classify!(model, context));
      expect(result.errorMessage).toBeUndefined();
      results.push({
        answers: result.answers,
        evaluated: sequences[0]!.tokenMeter.usedInputTokens - before,
      });
    }
    return results;
  });

const evaluatesTheSharedPromptOnce = (fixture: string) => () =>
  runTest(
    Effect.gen(function* () {
      const state = ticket("Ticket 1.");
      const [alone] = yield* classifyMetered(fixture, [
        { questions: { area: QUESTIONS["area"]! }, state },
      ]);
      const [fresh] = yield* classifyMetered(fixture, [{ questions: QUESTIONS, state }]);
      const [, afterAnother] = yield* classifyMetered(fixture, [
        { questions: QUESTIONS, state: ticket("Ticket 2.") },
        { questions: QUESTIONS, state },
      ]);

      expect(fresh!.evaluated).toBeLessThan(alone!.evaluated * 1.5);
      expect(afterAnother!.evaluated).toBeLessThan(alone!.evaluated * 1.5);
      expect(rounded(afterAnother!.answers)).toEqual(rounded(fresh!.answers));
    }),
  );

describe("node-llama-cpp classifier prompt reuse", () => {
  it.skipIf(!localLlmTests)(
    "evaluates the prompt the questions share once on an attention model",
    evaluatesTheSharedPromptOnce(ATTENTION_FIXTURE),
  );

  it.skipIf(!localLlmTests)(
    "evaluates the prompt the questions share once on a recurrent model",
    evaluatesTheSharedPromptOnce(RECURRENT_FIXTURE),
  );
});
