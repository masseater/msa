import { Effect, Schema } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import CredentialSynchronizationError from "../../../core/credential-synchronization-error.ts";
import errorsModule from "../../../utils/errors.ts";
import LoginDialogComponent from "../components/login-dialog.ts";
import type loginDialogTypes from "../components/login-dialog.types.ts";
import type oauthSelectorTypes from "../components/oauth-selector.types.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { LOGIN_CANCELLED, notifyAuthDialog } = loginFlowHelpers;
const { toErrorMessage } = errorsModule;

export default class ProviderLogin {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  private loginProvider(
    dialog: loginDialogTypes.LoginDialogComponent,
    providerId: string,
    providerName: string,
    method: loginFlowTypes.AuthType,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      host.programStatus.setBlocked("login", {
        kind: "auth",
        message: `Log in to ${providerName}`,
      });
      try {
        yield* awaited(
          host.session.models.selection.modelRuntime.login(
            providerId,
            method,
            {
              notify: (event) => notifyAuthDialog(dialog, event),
              prompt: (prompt) => Effect.runPromise(this.prompts.showAuthPrompt(dialog, prompt)),
              signal: dialog.signal,
            },
            { getDeviceId: () => host.session.settingsManager.telemetry.getOrCreateDeviceId() },
          ),
        );
      } finally {
        host.programStatus.setBlocked("login", undefined);
      }
    }, this.flow);
  }

  startProviderLogin(
    providerOption: oauthSelectorTypes.AuthSelectorProvider,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (providerOption.authType === "oauth") {
        yield* performed(
          this.providerLogin.runLoginDialog(
            providerOption.id,
            providerOption.name,
            "oauth",
            onBack,
          ),
        );
      } else if (providerOption.method?.login === undefined) {
        this.prompts.showAmbientAuthDialog(providerOption, onBack);
      } else {
        yield* performed(
          this.providerLogin.runLoginDialog(
            providerOption.id,
            providerOption.name,
            "api_key",
            onBack,
          ),
        );
      }
    }, this.flow);
  }

  private runLoginDialog(
    providerId: string,
    providerName: string,
    method: loginFlowTypes.AuthType,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const previousModel = host.session.model;
      const dialog = new LoginDialogComponent(host.ui, providerId, () => {}, providerName);
      host.editorSlot.show(dialog);

      const actionLabel =
        method === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;
      try {
        yield* performed(
          this.providerLogin.loginProvider(dialog, providerId, providerName, method),
        );
        host.editorSlot.restoreEditor();
        yield* awaited(
          this.authentication.completeProviderAuthentication(
            providerId,
            providerName,
            method,
            previousModel,
          ),
        );
      } catch (error: unknown) {
        host.editorSlot.restoreEditor();
        const message = toErrorMessage(error);
        if (Schema.is(CredentialSynchronizationError)(error)) {
          host.showError(
            `${actionLabel}, but local model state could not be synchronized: ${message}`,
          );
        } else if (dialog.signal.aborted || message === LOGIN_CANCELLED) {
          onBack?.();
        } else if (method === "oauth") {
          host.showError(`Failed to login to ${providerName}: ${message}`);
        } else {
          host.showError(`Failed to save API key for ${providerName}: ${message}`);
        }
      }
    }, this.flow);
  }
}
