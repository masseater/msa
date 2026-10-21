import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import agentSessionHelpers from "../agent-session-helpers.ts";
import type AgentSession from "../agent-session.ts";
import authGuidance from "../auth-guidance.ts";
import awaitingModule from "../awaiting.ts";
import messagesModule from "../messages.ts";
import virtualModels from "../virtual-models.ts";

const { isVirtualModel } = virtualModels;
const { streamSimple } = compat;
const { awaited, awaitingWith, performed } = awaitingModule;
const { formatNoApiKeyFoundMessage } = authGuidance;
const { convertToLlm } = messagesModule;
const { withoutDeletedHeaders } = agentSessionHelpers;

type RequestAuth = {
  model: compatTypes.Model<any>;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
};

function requestAuthFrom(
  model: compatTypes.Model<any>,
  result: compatTypes.AuthResult,
): RequestAuth {
  const requestModel =
    result.auth.baseUrl !== undefined && result.auth.baseUrl !== ""
      ? { ...model, baseUrl: result.auth.baseUrl }
      : model;
  return {
    apiKey: result.auth.apiKey,
    env: result.env,
    headers: withoutDeletedHeaders(result.auth.headers),
    model: requestModel,
  };
}

export default class SessionRequestAuth {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private get runtime() {
    return this.session.models.selection.modelRuntimeInternal;
  }

  private missingAuthError(provider: string): Error {
    if (this.runtime.isUsingOAuth(provider)) {
      return new Error(
        `Authentication failed for "${provider}". ` +
          `Credentials may have expired or network is unavailable. ` +
          `Run '/login ${provider}' to re-authenticate.`,
      );
    }
    return new Error(formatNoApiKeyFoundMessage(provider));
  }

  ensurePromptAuth(model: compatTypes.Model<any>): Effect.Effect<void> {
    return awaitingWith(function* () {
      const hasConfiguredAuth =
        this.runtime.hasConfiguredAuth(model.provider) ||
        (yield* awaited(this.runtime.checkAuth(model.provider))) !== undefined;
      if (hasConfiguredAuth) return;
      throw this.missingAuthError(model.provider);
    }, this);
  }

  private getRequiredRequestAuth(
    model: compatTypes.Model<any>,
    signal?: AbortSignal,
  ): Effect.Effect<RequestAuth> {
    return awaitingWith(function* () {
      let result: compatTypes.AuthResult | undefined;
      try {
        result = yield* awaited(
          this.runtime.getAuth(model, signal === undefined ? {} : { signal }),
        );
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        if (cause instanceof Error && cause.message === "authHeader requires a resolved API key") {
          throw new Error(formatNoApiKeyFoundMessage(model.provider), { cause: error });
        }
        throw error;
      }
      if (
        result !== undefined &&
        ((result.auth.apiKey ?? "") !== "" || result.auth.headers !== undefined)
      ) {
        return requestAuthFrom(model, result);
      }
      throw this.missingAuthError(model.provider);
    }, this);
  }

  getSummarizationRequestAuth(
    selectedModel: compatTypes.Model<any>,
    signal?: AbortSignal,
  ): Effect.Effect<RequestAuth & { thinkingLevel: agentTypes.ThinkingLevel }> {
    return awaitingWith(function* () {
      const { model, thinkingLevel } = isVirtualModel(selectedModel)
        ? yield* awaited(
            this.runtime.resolveModel(selectedModel, convertToLlm(this.session.messages), {
              reason: "direct",
              signal,
              thinkingLevel: this.session.thinkingLevel,
            }),
          )
        : { model: selectedModel, thinkingLevel: this.session.thinkingLevel };
      if (this.session.agent.streamFunction === streamSimple) {
        return { ...(yield* performed(this.getRequiredRequestAuth(model, signal))), thinkingLevel };
      }
      try {
        const result = yield* awaited(
          this.runtime.getAuth(model, signal === undefined ? {} : { signal }),
        );
        if (result === undefined) return { model, thinkingLevel };
        return { ...requestAuthFrom(model, result), thinkingLevel };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return { model, thinkingLevel };
      }
    }, this);
  }
}
