import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { describe, expect, it } from "vite-plus/test";

import goal from "../src/core/goal.ts";

const { classifyGoalError, parseGoalCommand, parseGoalEvaluation, pickEvaluatorModel } = goal;

const { fauxAssistantMessage } = ai;

function model(
  provider: string,
  id: string,
  input: number,
  output: number,
): aiTypes.Model<aiTypes.Api> {
  return {
    api: "faux",
    baseUrl: "",
    contextWindow: 200_000,
    cost: { cacheRead: 0, cacheWrite: 0, input, output },
    id,
    input: ["text"],
    maxTokens: 8192,
    name: id,
    provider,
    reasoning: false,
  };
}

function error(errorMessage: string) {
  return fauxAssistantMessage("", { errorMessage, stopReason: "error" });
}

const readsStatusClearAliasesAndConditions = () => {
  expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
  for (const word of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"]) {
    expect(parseGoalCommand(`/goal ${word}`)).toEqual({ kind: "clear" });
  }
  expect(parseGoalCommand("/goal tests pass\nand lint is clean")).toEqual({
    condition: "tests pass\nand lint is clean",
    kind: "set",
  });
  expect(parseGoalCommand("/goals")).toBeUndefined();
  expect(parseGoalCommand("set a /goal")).toBeUndefined();
};

describe("parseGoalCommand", () => {
  it("reads status, clear aliases, and conditions", readsStatusClearAliasesAndConditions);
});

const endsTheGoalOnAuthenticationCreditAnd = () => {
  for (const message of [
    "401 Unauthorized",
    "invalid x-api-key",
    "Your credit balance is too low",
    "insufficient_quota",
    "model: claude-x not found",
    "404 not_found_error",
  ]) {
    expect(classifyGoalError(error(message), false), message).toBe("fatal");
  }
  expect(classifyGoalError(error("prompt is too long"), true)).toBe("fatal");
};

const waitsOnRateLimitsAndRetriesAnything = () => {
  expect(classifyGoalError(error("429 Too Many Requests"), false)).toBe("rate_limit");
  expect(classifyGoalError(error("rate_limit_error"), false)).toBe("rate_limit");
  expect(classifyGoalError(error("socket hang up"), false)).toBe("transient");
};

describe("classifyGoalError", () => {
  it(
    "ends the goal on authentication, credit, and model availability errors",
    endsTheGoalOnAuthenticationCreditAnd,
  );

  it("waits on rate limits and retries anything else", waitsOnRateLimitsAndRetriesAnything);
});

const opus = model("anthropic-api", "claude-opus-4-8", 5, 25);

const picksTheStrongestSmallModelOfThe = () => {
  const available = [
    opus,
    model("anthropic-api", "claude-haiku-4-5", 1, 5),
    model("anthropic-api", "claude-haiku-5-5", 2, 10),
    model("openai", "gpt-5-mini", 0.25, 2),
  ];
  expect(pickEvaluatorModel(opus, available).id).toBe("claude-haiku-5-5");
};

const fallsBackToTheWorkingModel = () => {
  const gemini = model("opencode", "gemini-3.1-pro", 2, 12);
  expect(pickEvaluatorModel(gemini, [gemini, model("openai", "gpt-5-mini", 0.25, 2)])).toBe(gemini);

  expect(pickEvaluatorModel(gemini, [model("opencode", "gemini-ultra-lite", 9, 90)])).toBe(gemini);
};

describe("pickEvaluatorModel", () => {
  it(
    "picks the strongest small model of the working model's provider",
    picksTheStrongestSmallModelOfThe,
  );

  it("falls back to the working model", fallsBackToTheWorkingModel);
});

const readsTheVerdictFromJsonEvenWhen = () => {
  expect(parseGoalEvaluation('```json\n{"verdict":"met","reason":"all green"}\n```')).toEqual({
    reason: "all green",
    verdict: "met",
  });
  expect(parseGoalEvaluation('{"verdict":"maybe"}')).toBeUndefined();
  expect(parseGoalEvaluation("met")).toBeUndefined();
};

describe("parseGoalEvaluation", () => {
  it("reads the verdict from JSON, even when wrapped in prose", readsTheVerdictFromJsonEvenWhen);
});
