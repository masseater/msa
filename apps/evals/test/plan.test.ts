import { describe, expect, it } from "vite-plus/test";

import { createTaskPlan, parseDiscoveredCases } from "../src/plan.ts";

const discovered = [{ name: "adds the model", file: "evals/models.docs.eval.ts" }];

describe("parseDiscoveredCases", () => {
  it("derives stable case identity from the eval file and Vitest name", () => {
    expect(parseDiscoveredCases(discovered)).toEqual([
      {
        fullName: "adds the model",
        evalSet: "models",
        caseId: "adds the model",
        file: "evals/models.docs.eval.ts",
      },
    ]);
  });

  it("rejects empty and duplicate identities", () => {
    expect(() => parseDiscoveredCases([{ name: " ", file: "model.ts" }])).toThrow("empty name");
    expect(() => parseDiscoveredCases([...discovered, ...discovered])).toThrow(
      "Duplicate eval case identity",
    );
  });
});

describe("createTaskPlan", () => {
  it("creates one isolated task per case, variant, model, and repetition", () => {
    const cases = parseDiscoveredCases(discovered);
    const tasks = createTaskPlan(cases, "fixture/model", 2);
    expect(tasks).toHaveLength(4);
    expect(tasks.map(({ variant, runNumber }) => [variant, runNumber])).toEqual([
      ["without_docs", 1],
      ["with_docs", 1],
      ["with_docs", 2],
      ["without_docs", 2],
    ]);
  });

  it("rejects invalid model identities and repetitions", () => {
    const cases = parseDiscoveredCases(discovered);
    expect(() => createTaskPlan(cases, "model", 1)).toThrow("provider and model");
    expect(() => createTaskPlan(cases, "fixture/model", 0)).toThrow("positive integer");
  });
});
