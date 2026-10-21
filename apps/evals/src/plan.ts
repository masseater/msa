import { dual } from "effect/Function";

import type planTypes from "./plan.types.ts";

const DOCUMENTATION_VARIANTS = ["without_docs", "with_docs"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const evalSetOf = (file: string): string => {
  const base = file.split("/").at(-1) ?? file;
  return base.replace(/\.docs\.eval\.ts$/u, "");
};

function parseDiscoveredCases(value: unknown): planTypes.DiscoveredEvalCase[] {
  if (!Array.isArray(value)) throw new TypeError("Discovered eval cases must be an array.");
  const identities = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item["name"] !== "string" || typeof item["file"] !== "string") {
      throw new TypeError("Discovered eval case is invalid.");
    }
    const caseId = item["name"];
    if (caseId.trim() === "") throw new TypeError("Discovered eval case has an empty name.");
    const evalSet = evalSetOf(item["file"]);
    const identity = JSON.stringify([evalSet, caseId]);
    if (identities.has(identity))
      throw new TypeError(`Duplicate eval case identity: ${item["name"]}`);
    identities.add(identity);
    return { caseId, evalSet, file: item["file"], fullName: caseId };
  });
}

const createTaskPlan: {
  (
    model: string,
    runsPerVariant: number,
  ): (cases: readonly planTypes.DiscoveredEvalCase[]) => planTypes.EvalTask[];
  (
    cases: readonly planTypes.DiscoveredEvalCase[],
    model: string,
    runsPerVariant: number,
  ): planTypes.EvalTask[];
} = dual(
  3,
  (
    cases: readonly planTypes.DiscoveredEvalCase[],
    model: string,
    runsPerVariant: number,
  ): planTypes.EvalTask[] => {
    if (!model.includes("/") || model.startsWith("/") || model.endsWith("/")) {
      throw new TypeError("Model identity must contain a provider and model.");
    }
    if (!Number.isSafeInteger(runsPerVariant) || runsPerVariant < 1) {
      throw new TypeError("Runs per variant must be a positive integer.");
    }
    const tasks: planTypes.EvalTask[] = [];
    for (const evalCase of cases) {
      for (let runNumber = 1; runNumber <= runsPerVariant; runNumber += 1) {
        const variants: planTypes.DocumentationVariant[] =
          runNumber % 2 === 1 ? ["without_docs", "with_docs"] : ["with_docs", "without_docs"];
        for (const variant of variants) tasks.push({ ...evalCase, model, runNumber, variant });
      }
    }
    return tasks;
  },
);

const plan = {
  DOCUMENTATION_VARIANTS,
  createTaskPlan,
  parseDiscoveredCases,
};

export default plan;
