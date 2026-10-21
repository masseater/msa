import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import config from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import modelResolver from "../../../core/model-resolver.ts";
import platform from "../../../core/platform/index.ts";
import errorsModule from "../../../utils/errors.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

const { awaited, awaitingWith, awaiting } = awaitingModule;
const { getAuthPath } = config;
const {
  CREDENTIAL_TIMEOUT_MS,
  hasDefaultModelProvider,
  isUnknownModel,
  llamaCppPostLoginGuidance,
} = loginFlowHelpers;
const { toErrorMessage } = errorsModule;
const { defaultModelPerProvider } = modelResolver;
const { schedule } = platform;

function* selectDefaultModel(
  previousModel: compatTypes.Model<any> | undefined,
  host: loginFlowTypes.LoginFlowHost,
  providerId: string,
  actionLabel: string,
) {
  let selectedModel: compatTypes.Model<any> | undefined;
  let selectionError: string | undefined;
  if (isUnknownModel(previousModel)) {
    const providerModels = host.session.models.selection.modelRuntime
      .getAvailableSnapshot()
      .filter((model) => model.provider === providerId);
    if (providerId === "llama.cpp") {
      selectionError = llamaCppPostLoginGuidance(actionLabel, providerModels.length);
    } else if (!hasDefaultModelProvider(providerId)) {
      selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
    } else if (providerModels.length === 0) {
      selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
    } else {
      const defaultModelId = defaultModelPerProvider[providerId];
      selectedModel = providerModels.find((model) => model.id === defaultModelId);
      if (selectedModel === undefined) {
        selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
      } else {
        try {
          yield* awaited(host.session.models.selection.setModel(selectedModel, { persist: true }));
        } catch (error: unknown) {
          selectedModel = undefined;
          selectionError = `${actionLabel}, but selecting its default model failed: ${toErrorMessage(error)}. Use /model to select a model.`;
        }
      }
    }
  }
  return { selectedModel, selectionError };
}

type AuthenticationContext = {
  host: loginFlowTypes.LoginFlowHost;
  actionLabel: string;
  deferSelection: boolean;
  session: loginFlowTypes.LoginFlowHost["session"];
};

export default class ProviderAuthentication {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  private createFinishAuthentication(
    previousModel: compatTypes.Model<any> | undefined,
    host: loginFlowTypes.LoginFlowHost,
    providerId: string,
    actionLabel: string,
  ) {
    return () =>
      Effect.runPromise(
        awaiting(function* () {
          const { selectedModel, selectionError } = yield* selectDefaultModel(
            previousModel,
            host,
            providerId,
            actionLabel,
          );
          host.refreshAuthState();
          if (selectedModel === undefined) {
            host.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
            if (selectionError !== undefined && selectionError !== "") {
              host.showError(selectionError);
            }
          } else {
            host.showStatus(
              `${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`,
            );
          }
        }),
      );
  }

  completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: loginFlowTypes.AuthType,
    previousModel: compatTypes.Model<any> | undefined,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const context = this.authenticationContext(
          authType,
          providerName,
          previousModel,
          providerId,
        );
        const { host, actionLabel, deferSelection } = context;
        const finishAuthentication = this.createFinishAuthentication(
          previousModel,
          host,
          providerId,
          actionLabel,
        );
        if (deferSelection) {
          host.showStatus(
            `${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`,
          );
        } else {
          yield* awaited(finishAuthentication());
        }
        this.refreshCatalog(context, providerId, previousModel, finishAuthentication);
      }, this),
    );
  }

  private refreshCatalog(
    context: AuthenticationContext,
    providerId: string,
    previousModel: compatTypes.Model<any> | undefined,
    finishAuthentication: () => Promise<void>,
  ): void {
    const { host, actionLabel, deferSelection, session } = context;
    Effect.runFork(
      awaiting(function* () {
        const controller = new AbortController();
        const timeout = schedule(() => controller.abort(), CREDENTIAL_TIMEOUT_MS);
        try {
          const result = yield* awaited(
            session.models.selection.modelRuntime.refresh({
              providers: [providerId],
              signal: controller.signal,
            }),
          );
          if (result.aborted) {
            host.showWarning(
              `${actionLabel}, but its model catalog refresh timed out; using cached models.`,
            );
          } else if (result.errors.size > 0) {
            host.showWarning(
              `${actionLabel}, but its model catalog could not be refreshed; using cached models.`,
            );
          }
          if (deferSelection && host.session === session && session.model === previousModel) {
            yield* awaited(finishAuthentication());
          }
          host.refreshAuthState();
        } catch (error: unknown) {
          host.showWarning(
            `${actionLabel}, but its model catalog could not be refreshed: ${toErrorMessage(error)}`,
          );
        } finally {
          timeout.cancel();
        }
      }),
    );
  }

  private authenticationContext(
    authType: "oauth" | "api_key",
    providerName: string,
    previousModel: compatTypes.Model<any> | undefined,
    providerId: string,
  ): AuthenticationContext {
    const { host } = this.flow;
    const actionLabel =
      authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

    const session = host.session;
    const deferSelection =
      isUnknownModel(previousModel) &&
      hasDefaultModelProvider(providerId) &&
      !session.models.selection.modelRuntime
        .getAvailableSnapshot()
        .some(
          (model) =>
            model.provider === providerId && model.id === defaultModelPerProvider[providerId],
        );
    return { actionLabel, deferSelection, host, session };
  }
}
