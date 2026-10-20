import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import modelResolver from "../../core/model-resolver.ts";
import errorsModule from "../../utils/errors.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer4 from "./login-flow-layer-4.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaiting } = awaitingModule;
const { defaultModelPerProvider } = modelResolver;
const { toErrorMessage } = errorsModule;
const { getAuthPath } = config;
const { hasDefaultModelProvider, isUnknownModel, llamaCppPostLoginGuidance } = loginFlowHelpers;

export default abstract class LoginFlowLayer5 extends LoginFlowLayer4 {
  protected *completeProviderAuthenticationPart5(
    previousModel: compatTypes.Model<any> | undefined,
    host: loginFlowTypes.LoginFlowHost,
    providerId: string,
    actionLabel: string,
    deferSelection: boolean,
  ) {
    const finishAuthentication = this.completeProviderAuthenticationPart1(
      previousModel,
      host,
      providerId,
      actionLabel,
    );
    yield* this.completeProviderAuthenticationPart4(
      deferSelection,
      host,
      actionLabel,
      finishAuthentication,
    );
    return finishAuthentication;
  }

  protected completeProviderAuthenticationPart1(
    previousModel: compatTypes.Model<any> | undefined,
    host: loginFlowTypes.LoginFlowHost,
    providerId: string,
    actionLabel: string,
  ) {
    return () =>
      Effect.runPromise(
        awaiting(function* () {
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
                  yield* awaited(
                    host.session.models.selection.setModel(selectedModel, { persist: true }),
                  );
                } catch (error: unknown) {
                  selectedModel = undefined;
                  selectionError = `${actionLabel}, but selecting its default model failed: ${toErrorMessage(error)}. Use /model to select a model.`;
                }
              }
            }
          }

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
}
