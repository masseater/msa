import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import agentSessionHelpers from "./agent-session-helpers.ts";
import AgentSessionLayer24 from "./agent-session-layer-24.ts";
import awaitingModule from "./awaiting.ts";
import messagesModule from "./messages.ts";
import virtualModels from "./virtual-models.ts";
import type virtualModelsTypes from "./virtual-models.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { VIRTUAL_MODEL_STATE_ENTRY, getVirtualModelState, isVirtualModel } = virtualModels;
const { convertToLlm } = messagesModule;
const { streamSimple } = compat;
const { withoutDeletedHeaders } = agentSessionHelpers;

export default abstract class AgentSessionLayer25 extends AgentSessionLayer24 {
  protected getSummarizationRequestAuth(
    selectedModel: compatTypes.Model<any>,
    signal?: AbortSignal,
  ): Effect.Effect<{
    model: compatTypes.Model<any>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
    thinkingLevel: agentTypes.ThinkingLevel;
  }> {
    return awaitingWith(function* () {
      const { model, thinkingLevel } = isVirtualModel(selectedModel)
        ? yield* awaited(
            this.modelRuntimeInternal.resolveModel(selectedModel, convertToLlm(this.messages), {
              reason: "direct",
              signal,
              thinkingLevel: this.thinkingLevel,
            }),
          )
        : { model: selectedModel, thinkingLevel: this.thinkingLevel };
      if (this.agent.streamFunction === streamSimple) {
        return { ...(yield* performed(this.getRequiredRequestAuth(model, signal))), thinkingLevel };
      }

      try {
        const result = yield* awaited(
          this.modelRuntimeInternal.getAuth(model, signal === undefined ? {} : { signal }),
        );
        if (result === undefined) return { model, thinkingLevel };
        const requestModel =
          result.auth.baseUrl !== undefined && result.auth.baseUrl !== ""
            ? { ...model, baseUrl: result.auth.baseUrl }
            : model;
        return {
          apiKey: result.auth.apiKey,
          env: result.env,
          headers: withoutDeletedHeaders(result.auth.headers),
          model: requestModel,
          thinkingLevel,
        };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return { model, thinkingLevel };
      }
    }, this);
  }

  protected routeVirtualRequest(
    model: compatTypes.Model<any>,
    context: agentTypes.AgentContext,
    options: {
      failed: compatTypes.AssistantMessage | undefined;
      signal: AbortSignal | undefined;
      thinkingLevel: agentTypes.ThinkingLevel;
    },
  ) {
    return awaitingWith(function* () {
      const lastResponse = context.messages.findLastIndex(
        (message) => message.role === "assistant",
      );
      const userTurn = context.messages
        .slice(lastResponse + 1)
        .some((message) => message.role === "user");
      const state = getVirtualModelState(this.sessionManager.getBranch(), model.provider, model.id);
      const reason = options.failed === undefined ? (userTurn ? "user" : "continuation") : "retry";
      const route = yield* awaited(
        this.modelRuntimeInternal.resolveModel(model, convertToLlm(context.messages), {
          failed: options.failed,
          reason,
          signal: options.signal,
          state,
          thinkingLevel: options.thinkingLevel,
        }),
      );
      if (route.state !== undefined && route.state !== state) {
        const data: virtualModelsTypes.VirtualModelStateData = {
          modelId: model.id,
          provider: model.provider,
          state: route.state,
        };
        const entry = this.sessionManager.getEntry(
          this.sessionManager.appendCustomEntry(VIRTUAL_MODEL_STATE_ENTRY, data),
        );
        if (entry !== undefined) this.emit({ entry, type: "entry_appended" });
      }
      return route;
    }, this);
  }
}
