import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import agentSessionHelpers from "./agent-session-helpers.ts";
import AgentSessionLayer16 from "./agent-session-layer-16.ts";
import authGuidance from "./auth-guidance.ts";
import awaitingModule from "./awaiting.ts";
import goalModule from "./goal.ts";
import modelResolver from "./model-resolver.ts";

const { awaited, awaitingWith } = awaitingModule;
const { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } = authGuidance;
const { resolveModelReference } = modelResolver;
const { pickEvaluatorModel } = goalModule;
const { withoutDeletedHeaders } = agentSessionHelpers;

export default abstract class AgentSessionLayer17 extends AgentSessionLayer16 {
  protected getRequiredRequestAuth(
    model: compatTypes.Model<any>,
    signal?: AbortSignal,
  ): Effect.Effect<{
    model: compatTypes.Model<any>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
  }> {
    return awaitingWith(function* () {
      let result: compatTypes.AuthResult | undefined;
      try {
        result = yield* awaited(
          this.modelRuntimeInternal.getAuth(model, signal === undefined ? {} : { signal }),
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

      const isOAuth = this.modelRuntimeInternal.isUsingOAuth(model.provider);
      if (isOAuth) {
        throw new Error(
          `Authentication failed for "${model.provider}". ` +
            `Credentials may have expired or network is unavailable. ` +
            `Run '/login ${model.provider}' to re-authenticate.`,
        );
      }
      throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }, this);
  }

  protected goalEvaluatorModel(): compatTypes.Model<any> {
    const configured = this.settingsManager.getGoalEvaluatorModel();
    const available = this.modelRuntimeInternal.getAvailableSnapshot();
    if (configured !== undefined && configured !== "") {
      const result = resolveModelReference(
        { fuzzy: false, text: configured, thinkingSuffix: "none" },
        available,
        () => true,
      );
      if (result.status !== "resolved") {
        throw new Error(`goal.evaluatorModel "${configured}" is not an available model`);
      }
      return result.model;
    }
    const current = this.limitsModel();
    if (current === undefined) throw new Error(formatNoModelSelectedMessage());
    return pickEvaluatorModel(current, available);
  }
}
