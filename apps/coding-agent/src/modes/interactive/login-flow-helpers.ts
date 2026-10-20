import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import modelResolver from "../../core/model-resolver.ts";
import type loginDialogTypes from "./components/login-dialog.types.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { defaultModelPerProvider } = modelResolver;
const { awaited, awaiting } = awaitingModule;
const { getAuthPath } = config;

const LOGIN_CANCELLED = "Login cancelled";

const CREDENTIAL_TIMEOUT_MS = 15_000;

function isUnknownModel(model: compatTypes.Model<any> | undefined): boolean {
  return (
    model !== undefined &&
    model.provider === "unknown" &&
    model.id === "unknown" &&
    model.api === "unknown"
  );
}

function hasDefaultModelProvider(
  providerId: string,
): providerId is keyof typeof defaultModelPerProvider {
  return providerId in defaultModelPerProvider;
}

function llamaCppPostLoginGuidance(actionLabel: string, loadedModelCount: number): string {
  return loadedModelCount === 0
    ? `${actionLabel}. No llama.cpp models are loaded. Use /llama to load a model, then /model to select it.`
    : `${actionLabel}. Use /model to select a loaded llama.cpp model, or /llama to manage models.`;
}

function completeProviderAuthenticationPart2(
  deferSelection: boolean,
  host: loginFlowTypes.LoginFlowHost,
  actionLabel: string,
  finishAuthentication: () => Promise<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    if (deferSelection) {
      host.showStatus(
        `${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`,
      );
    } else {
      yield* awaited(finishAuthentication());
    }
  });
}

function notifyAuthDialog(
  dialog: loginDialogTypes.LoginDialogComponent,
  event: aiTypes.AuthEvent,
): void {
  if (event.type === "auth_url") {
    dialog.showAuth(event.url, event.instructions);
  } else if (event.type === "device_code") {
    dialog.showDeviceCode(event);
    dialog.showWaiting("Waiting for authentication...");
  } else if (event.type === "info") {
    dialog.showInfo(event.message, event.links);
  } else {
    dialog.showProgress(event.message);
  }
}

const loginFlowHelpers = {
  CREDENTIAL_TIMEOUT_MS,
  LOGIN_CANCELLED,
  completeProviderAuthenticationPart2,
  hasDefaultModelProvider,
  isUnknownModel,
  llamaCppPostLoginGuidance,
  notifyAuthDialog,
};

export default loginFlowHelpers;
