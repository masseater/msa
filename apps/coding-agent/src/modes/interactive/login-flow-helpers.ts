import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

import modelResolver from "../../core/model-resolver.ts";
import type loginDialogTypes from "./components/login-dialog.types.ts";
const { defaultModelPerProvider } = modelResolver;
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
  hasDefaultModelProvider,
  isUnknownModel,
  llamaCppPostLoginGuidance,
  notifyAuthDialog,
};

export default loginFlowHelpers;
