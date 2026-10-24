import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Effect } from "effect";

import Decide from "../src/core/decision/decide-service.ts";
import decideModule from "../src/core/decision/decide.ts";
import type decideTypes from "../src/core/decision/decide.types.ts";

const { closeServers, joinPath, makeTempDir, removeDirs } = testing;
const { LIQUID_D1, localProvider } = localModule;
const { decide: decideWith, makeDecide } = decideModule;

const FIXTURE = joinPath(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "libs",
  "ai",
  "test",
  "fixtures",
  "stories260K.gguf",
);

const directories: string[] = [];

const cleanUp = Effect.gen(function* () {
  yield* closeServers;
  yield* removeDirs(directories.splice(0));
});

const tempDirectory = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-decide-");
  directories.push(directory);
  return directory;
});

const classifierAt = (baseUrl: string): aiTypes.ClassifierModel<"node-llama-cpp-classify"> => ({
  ...LIQUID_D1,
  baseUrl,
  contextWindow: 4096,
});

const request = (
  ticket: string,
  thresholds: { route: number; severity: number },
): decideTypes.DecideRequest => ({
  name: "triage",
  questions: {
    route: {
      criteria: { billing: "money", technical: "code" },
      instructions: "Which team should answer?",
      threshold: thresholds.route,
      type: "choice",
    },
    severity: {
      criteria: ["minor", "moderate", "severe"],
      instructions: "How severe is it?",
      threshold: thresholds.severity,
      type: "score",
    },
  },
  state: { ticket },
});

interface Recorded {
  classifications: number;
  undecided: Array<{ name: string; reason: string }>;
  usage: aiTypes.ClassifierResult[];
}

const localDecide = Effect.fn("localDecide")(function* (
  model: aiTypes.ClassifierModel<"node-llama-cpp-classify">,
  options: {
    endpoints?: { huggingFace: string };
    thresholds?: Record<string, number>;
    unavailable?: string;
  } = {},
) {
  const directory = yield* tempDirectory;
  const provider = localProvider(
    { directory, ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }) },
    [model],
  );
  const recorded: Recorded = { classifications: 0, undecided: [], usage: [] };
  const host: decideTypes.DecisionHost = {
    classify: (classifier, context, signal) => {
      recorded.classifications += 1;
      return provider.classify!(classifier, context, { signal });
    },
    model: () =>
      options.unavailable === undefined ? { model } : { unavailable: options.unavailable },
    recordUndecided: (name, reason) => recorded.undecided.push({ name, reason }),
    recordUsage: (result) => recorded.usage.push(result),
    threshold: (key) => options.thresholds?.[key],
  };
  const service = yield* makeDecide(host);
  const decide = (decideRequest: decideTypes.DecideRequest) =>
    decideWith(decideRequest).pipe(Effect.provideService(Decide, service));
  return { decide, provider, recorded };
});

const loadedDecide = Effect.fn("loadedDecide")(function* (
  model: aiTypes.ClassifierModel<"node-llama-cpp-classify">,
  options: { thresholds?: Record<string, number> } = {},
) {
  const local = yield* localDecide(model, options);
  yield* Effect.promise(() => local.provider.prepareClassifier!(model));
  return local;
});

const blocking = (threshold: number): decideTypes.DecideRequest => ({
  name: "triage",
  questions: {
    blocking: {
      criteria: { false: "others can keep working", true: "stops everyone" },
      instructions: "Does it block the team?",
      threshold,
      type: "bool",
    },
  },
  state: { ticket: "The build fails." },
});

const decideSupport = {
  FIXTURE,
  blocking,
  classifierAt,
  cleanUp,
  loadedDecide,
  localDecide,
  request,
  tempDirectory,
};

export default decideSupport;
