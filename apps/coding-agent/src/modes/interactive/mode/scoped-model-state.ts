import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

import modelScope from "../../../core/model-scope.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { resolveModelScopeFromModels } = modelScope;

export default class ScopedModelState {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  scopedModelSelectionState(): {
    currentEnabledIds: string[] | null;
    availableModelIds: Set<string>;
    availableModels: compatTypes.Model<aiTypes.Api>[];
    selectionChanged: boolean;
    sessionScopedModels: readonly {
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }[];
    configuredEnabledIds: (models: readonly compatTypes.Model<any>[]) => string[] | null;
  } {
    let availableModels = [
      ...this.mode.session.models.selection.modelRuntime.getAvailableSnapshot(),
    ];
    let availableModelIds = new Set(
      availableModels.map((model) => `${model.provider}/${model.id}`),
    );
    const configuredPatterns = this.mode.settingsManager.models.getEnabledModels();
    const sessionScopedModels = this.mode.session.models.selection.scopedModels;
    const configuredEnabledIds = (models: readonly compatTypes.Model<any>[]): string[] | null => {
      if (configuredPatterns?.length === undefined || configuredPatterns?.length === 0) return null;
      const resolved = resolveModelScopeFromModels(configuredPatterns, models);
      const ids = resolved.scopedModels.map(
        (scoped) => `${scoped.model.provider}/${scoped.model.id}`,
      );
      for (const diagnostic of resolved.diagnostics) {
        if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern))
          ids.push(diagnostic.pattern);
      }
      return ids;
    };

    let currentEnabledIds =
      sessionScopedModels.length > 0
        ? sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)
        : configuredEnabledIds(availableModels);
    let selectionChanged = false;
    return {
      availableModelIds,
      availableModels,
      configuredEnabledIds,
      currentEnabledIds,
      selectionChanged,
      sessionScopedModels,
    };
  }
}
