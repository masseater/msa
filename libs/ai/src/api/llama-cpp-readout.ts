import { Function } from "effect";

import type typesModule from "../types.types.ts";

const MIN_READOUT_DEPTH = 256;

const READOUT_DEPTH_PER_LABEL = 16;

const READOUT_ESCALATION = [4096, 32768];

const UNDERFLOW_LOGPROB = -1e30;

const labelProbabilities: {
  (temperature: number): (logprobs: readonly number[]) => number[];
  (logprobs: readonly number[], temperature: number): number[];
} = Function.dual(2, function (logprobs: readonly number[], temperature: number): number[] {
  const scaled = logprobs.map((logprob) => logprob / temperature);
  const max = Math.max(...scaled);
  const weights = scaled.map((value) => Math.exp(value - max));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
});

function peakConfidence(probabilities: readonly number[]): number {
  const n = probabilities.length;
  const peak = Math.max(...probabilities);
  return Math.min(1, Math.max(0, (n * peak - 1) / (n - 1)));
}

const answerFromProbabilities: {
  (
    keys: readonly string[],
    probabilities: readonly number[],
  ): (question: typesModule.ClassifierQuestion) => typesModule.ClassifierAnswer;
  (
    question: typesModule.ClassifierQuestion,
    keys: readonly string[],
    probabilities: readonly number[],
  ): typesModule.ClassifierAnswer;
} = Function.dual(
  3,
  function (
    question: typesModule.ClassifierQuestion,
    keys: readonly string[],
    probabilities: readonly number[],
  ): typesModule.ClassifierAnswer {
    if (question.type === "bool") {
      return { probability: probabilities[keys.indexOf("true")]!, type: "bool" };
    }
    const confidence = peakConfidence(probabilities);
    if (question.type === "score") {
      const score = probabilities.reduce((sum, probability, index) => sum + index * probability, 0);
      return { confidence, score, type: "score" };
    }
    let best = 0;
    for (let index = 1; index < probabilities.length; index++) {
      if (probabilities[index]! > probabilities[best]!) best = index;
    }
    return {
      choice: keys[best]!,
      confidence,
      probabilities: Object.fromEntries(keys.map((key, index) => [key, probabilities[index]!])),
      type: "choice",
    };
  },
);

const llamaCppReadout = {
  MIN_READOUT_DEPTH,
  READOUT_DEPTH_PER_LABEL,
  READOUT_ESCALATION,
  UNDERFLOW_LOGPROB,
  answerFromProbabilities,
  labelProbabilities,
  peakConfidence,
};

export default llamaCppReadout;
