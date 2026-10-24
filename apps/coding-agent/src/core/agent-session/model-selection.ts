import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import virtualModels from "../virtual-models.ts";

const { isVirtualModel, findLatestResponse, getBranchSelection } = virtualModels;
const { modelsAreEqual } = compat;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class SessionModelSelection {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  scopedModelsInternal!: Array<{
    model: compatTypes.Model<any>;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }>;

  modelRuntimeInternal!: modelRuntimeTypes.ModelRuntime;

  get modelRuntime(): modelRuntimeTypes.ModelRuntime {
    return this.modelRuntimeInternal;
  }

  refreshCurrentModelFromRegistry(): void {
    const currentModel = this.session.model;
    if (currentModel === undefined) {
      return;
    }

    const refreshedModel = this.modelRuntimeInternal.getModel(
      currentModel.provider,
      currentModel.id,
    );
    if (refreshedModel === undefined || refreshedModel === currentModel) {
      return;
    }

    this.session.agent.state.model = refreshedModel;
  }

  modelForMessage(message: compatTypes.AssistantMessage): compatTypes.Model<any> | undefined {
    const model = this.session.model;
    if (model !== undefined && isVirtualModel(model))
      return this.modelRuntimeInternal.getPhysicalModel(message.provider, message.model);
    return model?.provider === message.provider && model.id === message.model ? model : undefined;
  }

  get scopedModels(): ReadonlyArray<{
    model: compatTypes.Model<any>;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }> {
    return this.scopedModelsInternal;
  }

  setScopedModels(
    scopedModels: Array<{
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }>,
  ): void {
    this.scopedModelsInternal = scopedModels;
  }

  recordSelection(): void {
    const model = this.session.model;
    if (model === undefined) return;
    const getModel = (provider: string, modelId: string) =>
      this.modelRuntimeInternal.getModel(provider, modelId);
    const recorded = getBranchSelection(this.session.sessionManager.getBranch(), getModel);
    if (
      recorded === undefined ||
      (recorded.provider === model.provider && recorded.modelId === model.id)
    )
      return;
    const recordedModel = getModel(recorded.provider, recorded.modelId);
    if (!isVirtualModel(model) && (recordedModel && isVirtualModel(recordedModel)) !== true) return;
    this.session.sessionManager.appendModelChange(model.provider, model.id);
  }

  limitsModel(): compatTypes.Model<any> | undefined {
    return this.routedModel?.model ?? this.session.model;
  }

  get routedModel():
    | { model: compatTypes.Model<any>; thinkingLevel?: agentTypes.ThinkingLevel | undefined }
    | undefined {
    if (this.session.model === undefined || !isVirtualModel(this.session.model)) return undefined;
    const latest = findLatestResponse(this.session.agent.state.messages);
    const model =
      latest && this.modelRuntimeInternal.getPhysicalModel(latest.provider, latest.model);
    return model && { model, thinkingLevel: latest?.thinkingLevel };
  }

  private addPersistedDefaultToNonEmptyScope(model: compatTypes.Model<any>): void {
    if (this.scopedModelsInternal.length === 0) return;
    if (this.scopedModelsInternal.some((scoped) => modelsAreEqual(scoped.model, model))) return;

    this.scopedModelsInternal = [...this.scopedModelsInternal, { model }];

    const enabledModels = this.session.settingsManager.models.getEnabledModels();
    if (enabledModels?.length === undefined || enabledModels?.length === 0) return;

    const modelReference = `${model.provider}/${model.id}`;
    if (enabledModels.some((pattern) => pattern.toLowerCase() === modelReference.toLowerCase()))
      return;
    this.session.settingsManager.models.setEnabledModels([...enabledModels, modelReference]);
  }

  private emitModelSelect(
    nextModel: compatTypes.Model<any>,
    previousModel: compatTypes.Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (modelsAreEqual(previousModel, nextModel)) return;
      yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emit({
          model: nextModel,
          previousModel,
          source,
          type: "model_select",
        }),
      );
    }, this);
  }

  private switchModel(
    next: { model: compatTypes.Model<any>; thinkingLevel?: agentTypes.ThinkingLevel | undefined },
    options: agentSessionTypes.ModelMutationOptions,
    source: "set" | "cycle",
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const previousModel = this.session.model;
      const thinkingLevel = this.session.models.thinking.getThinkingLevelForModelSwitch(
        next.model,
        next.thinkingLevel,
      );
      this.session.agent.state.model = next.model;
      this.session.sessionManager.appendModelChange(next.model.provider, next.model.id);
      if (options.persist === true) {
        this.session.settingsManager.models.setDefaultModelAndProvider(
          next.model.provider,
          next.model.id,
        );
        this.addPersistedDefaultToNonEmptyScope(next.model);
      }

      this.session.models.thinking.setThinkingLevel(thinkingLevel);

      yield* performed(this.emitModelSelect(next.model, previousModel, source));
    }, this);
  }

  fallbackModel(
    failedProviders: ReadonlySet<string>,
  ): Effect.Effect<compatTypes.Model<any> | undefined> {
    return awaitingWith(function* () {
      const available = new Set(
        (yield* awaited(this.modelRuntimeInternal.getAvailable())).map(
          (model) => `${model.provider}\0${model.id}`,
        ),
      );
      const next = this.scopedModelsInternal.find(
        (scoped) =>
          !failedProviders.has(scoped.model.provider) &&
          available.has(`${scoped.model.provider}\0${scoped.model.id}`),
      );
      if (next === undefined) return undefined;
      yield* performed(this.switchModel(next, {}, "set"));
      return next.model;
    }, this);
  }

  setModel(
    model: compatTypes.Model<any>,
    options: agentSessionTypes.ModelMutationOptions = {},
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if ((yield* awaited(this.modelRuntimeInternal.checkAuth(model.provider))) === undefined) {
          throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        yield* performed(this.switchModel({ model }, options, "set"));
        this.session.run.fallback.resumeAfterModelChange();
      }, this),
    );
  }

  cycleModel(
    direction: "forward" | "backward" = "forward",
    options: agentSessionTypes.ModelMutationOptions = {},
  ): Promise<agentSessionTypes.ModelCycleResult | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const result =
          this.scopedModelsInternal.length > 0
            ? yield* performed(this.cycleScopedModel(direction, options))
            : yield* performed(this.cycleAvailableModel(direction, options));
        if (result !== undefined) this.session.run.fallback.resumeAfterModelChange();
        return result;
      }, this),
    );
  }

  private cycleScopedModel(
    direction: "forward" | "backward",
    options: agentSessionTypes.ModelMutationOptions,
  ): Effect.Effect<agentSessionTypes.ModelCycleResult | undefined> {
    return awaitingWith(function* () {
      const availableIds = new Set(
        this.modelRuntimeInternal
          .getAvailableSnapshot()
          .map((model) => `${model.provider}\0${model.id}`),
      );
      const scopedModels = this.scopedModelsInternal.filter((scoped) =>
        availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`),
      );
      if (scopedModels.length <= 1) return undefined;

      const currentModel = this.session.model;
      let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

      if (currentIndex === -1) currentIndex = 0;
      const len = scopedModels.length;
      const nextIndex =
        direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
      const next = scopedModels[nextIndex];
      if (next === undefined) return undefined;
      yield* performed(this.switchModel(next, options, "cycle"));
      return { isScoped: true, model: next.model, thinkingLevel: this.session.thinkingLevel };
    }, this);
  }

  private cycleAvailableModel(
    direction: "forward" | "backward",
    options: agentSessionTypes.ModelMutationOptions,
  ): Effect.Effect<agentSessionTypes.ModelCycleResult | undefined> {
    return awaitingWith(function* () {
      const availableModels = this.modelRuntimeInternal.getAvailableSnapshot();
      if (availableModels.length <= 1) return undefined;

      const currentModel = this.session.model;
      let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

      if (currentIndex === -1) currentIndex = 0;
      const len = availableModels.length;
      const nextIndex =
        direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
      const nextModel = availableModels[nextIndex];
      if (nextModel === undefined) return undefined;
      yield* performed(this.switchModel({ model: nextModel }, options, "cycle"));
      return { isScoped: false, model: nextModel, thinkingLevel: this.session.thinkingLevel };
    }, this);
  }

  configure(
    scopedModels: SessionModelSelection["scopedModelsInternal"],
    modelRuntime: modelRuntimeTypes.ModelRuntime,
  ): void {
    this.scopedModelsInternal = scopedModels;
    this.modelRuntimeInternal = modelRuntime;
    modelRuntime.setModelPolicy(this.session.settingsManager.models.getModelPolicy());
  }
}
