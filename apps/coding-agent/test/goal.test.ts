import { type Api, fauxAssistantMessage, type Model } from "@msa/ai";
import { describe, expect, it } from "vitest";

import {
  classifyGoalError,
  parseGoalCommand,
  parseGoalEvaluation,
  pickEvaluatorModel,
} from "../src/core/goal.ts";

function model(provider: string, id: string, input: number, output: number): Model<Api> {
  return {
    id,
    name: id,
    api: "faux",
    provider,
    baseUrl: "",
    input: ["text"],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}

function error(errorMessage: string) {
  return fauxAssistantMessage("", { stopReason: "error", errorMessage });
}

describe("parseGoalCommand", () => {
  it("reads status, clear aliases, and conditions", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
    for (const word of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"]) {
      expect(parseGoalCommand(`/goal ${word}`)).toEqual({ kind: "clear" });
    }
    expect(parseGoalCommand("/goal tests pass\nand lint is clean")).toEqual({
      kind: "set",
      condition: "tests pass\nand lint is clean",
    });
    expect(parseGoalCommand("/goals")).toBeUndefined();
    expect(parseGoalCommand("set a /goal")).toBeUndefined();
  });
});

describe("classifyGoalError", () => {
  it("ends the goal on authentication, credit, and model availability errors", () => {
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
  });

  it("waits on rate limits and retries anything else", () => {
    expect(classifyGoalError(error("429 Too Many Requests"), false)).toBe("rate_limit");
    expect(classifyGoalError(error("rate_limit_error"), false)).toBe("rate_limit");
    expect(classifyGoalError(error("socket hang up"), false)).toBe("transient");
  });
});

describe("pickEvaluatorModel", () => {
  const opus = model("anthropic", "claude-opus-4-8", 5, 25);

  it("picks the strongest small model of the working model's provider", () => {
    const available = [
      opus,
      model("anthropic", "claude-haiku-4-5", 1, 5),
      model("anthropic", "claude-haiku-5-5", 2, 10),
      model("openai", "gpt-5-mini", 0.25, 2),
    ];
    expect(pickEvaluatorModel(opus, available).id).toBe("claude-haiku-5-5");
  });

  it("falls back to the working model", () => {
    const gemini = model("google", "gemini-3.1-pro", 2, 12);
    expect(pickEvaluatorModel(gemini, [gemini, model("openai", "gpt-5-mini", 0.25, 2)])).toBe(
      gemini,
    );
    // "gemini" is not a small-tier name, and pricier models are never picked.
    expect(pickEvaluatorModel(gemini, [model("google", "gemini-ultra-lite", 9, 90)])).toBe(gemini);
  });
});

describe("parseGoalEvaluation", () => {
  it("reads the verdict from JSON, even when wrapped in prose", () => {
    expect(parseGoalEvaluation('```json\n{"verdict":"met","reason":"all green"}\n```')).toEqual({
      verdict: "met",
      reason: "all green",
    });
    expect(parseGoalEvaluation('{"verdict":"maybe"}')).toBeUndefined();
    expect(parseGoalEvaluation("met")).toBeUndefined();
  });
});
