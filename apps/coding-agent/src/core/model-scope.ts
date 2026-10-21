import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { minimatch } from "minimatch";

import modelResolver from "./model-resolver.ts";
import type modelResolverTypes from "./model-resolver.types.ts";

const { resolveModelReference, splitThinkingSuffix } = modelResolver;
const { modelsAreEqual } = ai;

type Model = aiTypes.Model<aiTypes.Api>;

class ScopeCollector {
  readonly scopedModels: modelResolverTypes.ScopedModel[] = [];

  readonly diagnostics: modelResolverTypes.ModelScopeDiagnostic[] = [];

  add(model: Model, thinkingLevel: agentTypes.ThinkingLevel | undefined): void {
    if (!this.scopedModels.some((scoped) => modelsAreEqual(scoped.model, model))) {
      this.scopedModels.push({ model, thinkingLevel });
    }
  }

  noMatch(pattern: string): void {
    this.diagnostics.push({
      code: "no-match",
      message: `No models match pattern "${pattern}"`,
      pattern,
      type: "warning",
    });
  }

  ambiguous(pattern: string, candidates: readonly Model[]): void {
    const providers = [...new Set(candidates.map((m) => m.provider))].sort((a, b) =>
      a.localeCompare(b),
    );
    this.diagnostics.push({
      code: "ambiguous",
      message: `Pattern "${pattern}" matches several providers: ${providers.join(", ")}. Use provider/id to choose one.`,
      pattern,
      type: "warning",
    });
  }

  addGlobPattern(pattern: string, models: readonly Model[]): void {
    const thinking = splitThinkingSuffix(pattern);
    const globPattern = thinking?.base ?? pattern;
    const exact = resolveModelReference(
      { fuzzy: false, text: globPattern, thinkingSuffix: "none" },
      models,
      () => true,
    );
    let matches: readonly Model[];
    if (exact.status === "resolved") {
      matches = [exact.model];
    } else if (exact.status === "ambiguous") {
      matches = exact.candidates;
      this.ambiguous(pattern, matches);
    } else {
      matches = models.filter(
        (m) =>
          minimatch(`${m.provider}/${m.id}`, globPattern, { nocase: true }) ||
          minimatch(m.id, globPattern, { nocase: true }),
      );
    }
    if (matches.length === 0) this.noMatch(pattern);
    for (const model of matches) this.add(model, thinking?.thinkingLevel);
  }

  addReferencePattern(pattern: string, models: readonly Model[]): void {
    const result = resolveModelReference(
      { fuzzy: true, text: pattern, thinkingSuffix: "lenient" },
      models,
      () => true,
    );
    if (result.status === "not-found") {
      this.noMatch(pattern);
      return;
    }
    if (result.warning !== undefined && result.warning !== "") {
      this.diagnostics.push({
        code: "invalid-thinking-level",
        message: result.warning,
        pattern,
        type: "warning",
      });
    }
    if (result.status === "ambiguous") this.ambiguous(pattern, result.candidates);
    const matches = result.status === "resolved" ? [result.model] : result.candidates;
    for (const model of matches) this.add(model, result.thinkingLevel);
  }
}

function resolveModelScopeFromModels(
  patterns: string[],
  models: readonly Model[],
): modelResolverTypes.ResolveModelScopeResult {
  const collector = new ScopeCollector();
  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
      collector.addGlobPattern(pattern, models);
    } else {
      collector.addReferencePattern(pattern, models);
    }
  }
  return { diagnostics: collector.diagnostics, scopedModels: collector.scopedModels };
}

const modelScope = { resolveModelScopeFromModels };

export default modelScope;
