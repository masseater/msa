import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type typesModulePart1 from "@msa/ai/types-part1.types";
import { minimatch } from "minimatch";

import modelResolverPart1 from "./model-resolver-part1.ts";
import type modelResolverTypes from "./model-resolver.types.ts";

const { modelsAreEqual } = ai;
const { resolveModelReference, splitThinkingSuffix } = modelResolverPart1;

function resolveModelScopeFromModels(
  patterns: string[],
  models: readonly aiTypes.Model<aiTypes.Api>[],
): modelResolverTypes.ResolveModelScopeResult {
  const {
    ambiguous,
    noMatch,
    add,
    diagnostics,
    scopedModels,
  }: {
    ambiguous: (pattern: string, candidates: readonly aiTypes.Model<aiTypes.Api>[]) => void;
    noMatch: (pattern: string) => number;
    add: (
      model: aiTypes.Model<aiTypes.Api>,
      thinkingLevel: agentTypes.ThinkingLevel | undefined,
    ) => void;
    diagnostics: modelResolverTypes.ModelScopeDiagnostic[];
    scopedModels: modelResolverTypes.ScopedModel[];
  } = resolveModelScopeFromModelsPart1();

  resolveModelScopeFromModelsPart3(patterns, models, ambiguous, noMatch, add, diagnostics);

  return { diagnostics, scopedModels };
}

function resolveModelScopeFromModelsPart3(
  patterns: string[],
  models: readonly aiTypes.Model<typesModulePart1.Api>[],
  ambiguous: (pattern: string, candidates: readonly aiTypes.Model<aiTypes.Api>[]) => void,
  noMatch: (pattern: string) => number,
  add: (
    model: aiTypes.Model<aiTypes.Api>,
    thinkingLevel: agentTypes.ThinkingLevel | undefined,
  ) => void,
  diagnostics: modelResolverTypes.ModelScopeDiagnostic[],
) {
  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
      const thinking = splitThinkingSuffix(pattern);
      const globPattern = thinking?.base ?? pattern;
      const thinkingLevel = thinking?.thinkingLevel;

      const exact = resolveModelReference(
        { fuzzy: false, text: globPattern, thinkingSuffix: "none" },
        models,
        () => true,
      );
      let matches: readonly aiTypes.Model<aiTypes.Api>[] = resolveModelScopeFromModelsPart2(
        exact,
        ambiguous,
        pattern,
        models,
        globPattern,
      );
      if (matches.length === 0) noMatch(pattern);
      for (const model of matches) add(model, thinkingLevel);
      continue;
    }

    const result = resolveModelReference(
      { fuzzy: true, text: pattern, thinkingSuffix: "lenient" },
      models,
      () => true,
    );
    if (result.status === "not-found") {
      noMatch(pattern);
      continue;
    }
    if (result.warning !== undefined && result.warning !== "") {
      diagnostics.push({
        code: "invalid-thinking-level",
        message: result.warning,
        pattern,
        type: "warning",
      });
    }
    if (result.status === "ambiguous") ambiguous(pattern, result.candidates);
    const matches = result.status === "resolved" ? [result.model] : result.candidates;
    for (const model of matches) add(model, result.thinkingLevel);
  }
}

function resolveModelScopeFromModelsPart2(
  exact: modelResolverTypes.ModelReferenceResult,
  ambiguous: (pattern: string, candidates: readonly aiTypes.Model<aiTypes.Api>[]) => void,
  pattern: string,
  models: readonly aiTypes.Model<typesModulePart1.Api>[],
  globPattern: string,
) {
  let matches: readonly aiTypes.Model<aiTypes.Api>[];
  if (exact.status === "resolved") matches = [exact.model];
  else if (exact.status === "ambiguous") {
    matches = exact.candidates;
    ambiguous(pattern, matches);
  } else {
    matches = models.filter(
      (m) =>
        minimatch(`${m.provider}/${m.id}`, globPattern, { nocase: true }) ||
        minimatch(m.id, globPattern, { nocase: true }),
    );
  }
  return matches;
}

function resolveModelScopeFromModelsPart1() {
  const scopedModels: modelResolverTypes.ScopedModel[] = [];
  const diagnostics: modelResolverTypes.ModelScopeDiagnostic[] = [];
  const add = (
    model: aiTypes.Model<aiTypes.Api>,
    thinkingLevel: agentTypes.ThinkingLevel | undefined,
  ) => {
    if (!scopedModels.some((scoped) => modelsAreEqual(scoped.model, model))) {
      scopedModels.push({ model, thinkingLevel });
    }
  };
  const noMatch = (pattern: string) =>
    diagnostics.push({
      code: "no-match",
      message: `No models match pattern "${pattern}"`,
      pattern,
      type: "warning",
    });
  const ambiguous = (pattern: string, candidates: readonly aiTypes.Model<aiTypes.Api>[]) => {
    const providers = [...new Set(candidates.map((m) => m.provider))].sort((a, b) =>
      a.localeCompare(b),
    );
    diagnostics.push({
      code: "ambiguous",
      message: `Pattern "${pattern}" matches several providers: ${providers.join(", ")}. Use provider/id to choose one.`,
      pattern,
      type: "warning",
    });
  };
  return { add, ambiguous, diagnostics, noMatch, scopedModels };
}

const modelResolverPart2 = {
  resolveModelScopeFromModels,
};

export default modelResolverPart2;
