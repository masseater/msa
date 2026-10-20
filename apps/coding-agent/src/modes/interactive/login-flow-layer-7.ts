import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import CredentialSynchronizationError from "../../core/credential-synchronization-error.ts";
import errorsModule from "../../utils/errors.ts";
import LoginDialogComponent from "./components/login-dialog.ts";
import OAuthSelectorComponent from "./components/oauth-selector.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer6 from "./login-flow-layer-6.ts";
import LoginFlow from "./login-flow.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { LOGIN_CANCELLED } = loginFlowHelpers;

export default abstract class LoginFlowLayer7 extends LoginFlowLayer6 {
  startProviderLogin(
    providerOption: oauthSelectorTypes.AuthSelectorProvider,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        if (providerOption.authType === "oauth") {
          yield* performed(
            this.runLoginDialog(providerOption.id, providerOption.name, "oauth", onBack),
          );
        } else if (providerOption.method?.login === undefined) {
          this.showAmbientAuthDialog(providerOption, onBack);
        } else {
          yield* performed(
            this.runLoginDialog(providerOption.id, providerOption.name, "api_key", onBack),
          );
        }
      },
      this as unknown as LoginFlow,
    );
  }

  showAuthTypeSelector(providerOptions?: oauthSelectorTypes.AuthSelectorProvider[]): void {
    const { host } = this;
    const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
    const oauthLoginLabel =
      oauthProvider?.method !== undefined && "loginLabel" in oauthProvider.method
        ? oauthProvider.method.loginLabel
        : undefined;
    const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
    const apiKeyLabel = "Sign in with an API key";
    const availableAuthTypes =
      providerOptions === undefined
        ? new Set<loginFlowTypes.AuthType>(["oauth", "api_key"])
        : new Set(providerOptions.map((provider) => provider.authType));
    const serviceLabel =
      providerOptions === undefined &&
      host.session.tools.externalServices.getExternalServices().length > 0
        ? "Sign in to a service"
        : undefined;
    const options: string[] = [];
    if (availableAuthTypes.has("oauth")) options.push(subscriptionLabel);
    if (availableAuthTypes.has("api_key")) options.push(apiKeyLabel);
    if (serviceLabel !== undefined) options.push(serviceLabel);

    if (options.length === 0) {
      host.showStatus("No login methods available.");
      return;
    }

    if (providerOptions !== undefined && options.length === 1) {
      const providerOption = providerOptions[0];
      if (providerOption !== undefined) {
        void Effect.runFork(this.startProviderLogin(providerOption));
      }
      return;
    }

    const title =
      providerOptions?.[0] === undefined
        ? "Select authentication method:"
        : `Select authentication method for ${providerOptions[0].name}:`;
    LoginFlow.showAuthTypeSelectorPart1(
      this as unknown as LoginFlow,
      host,
      serviceLabel,
      subscriptionLabel,
      providerOptions,
      title,
      options,
    );
  }

  showProviderSelector(authType?: loginFlowTypes.AuthType, initialSearchInput?: string): void {
    const { host } = this;
    const providerOptions = this.getProviderOptions(authType);
    if (providerOptions.length === 0) {
      host.showStatus(
        authType === "oauth"
          ? "No account providers available."
          : authType === "api_key"
            ? "No API key providers available."
            : "No login providers available.",
      );
      return;
    }

    host.editorSlot.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        "login",
        providerOptions,
        (providerId, selectedAuthType) =>
          Effect.runPromise(
            awaitingWith(
              function* () {
                done();
                const providerOption = providerOptions.find(
                  (provider) =>
                    provider.id === providerId && provider.authType === selectedAuthType,
                );
                if (providerOption === undefined) {
                  return;
                }
                yield* performed(
                  this.startProviderLogin(providerOption, () =>
                    this.showProviderSelector(authType, initialSearchInput),
                  ),
                );
              },
              this as unknown as LoginFlow,
            ),
          ),
        () => {
          this.showProviderSelectorPart1(done, authType, host);
        },
        initialSearchInput,
      );
      return { component: selector, focus: selector };
    });
  }

  protected showProviderSelectorPart1(
    done: () => void,
    authType: string | undefined,
    host: loginFlowTypes.LoginFlowHost,
  ) {
    done();
    if (authType === undefined) {
      host.ui.requestRender();
    } else {
      this.showAuthTypeSelector();
    }
  }

  protected runLoginDialog(
    providerId: string,
    providerName: string,
    method: loginFlowTypes.AuthType,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        const { host } = this;
        const previousModel = host.session.model;
        const dialog = new LoginDialogComponent(host.ui, providerId, () => {}, providerName);
        host.editorSlot.show(dialog);

        const actionLabel =
          method === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;
        try {
          yield* performed(this.loginProvider(dialog, providerId, providerName, method));
          host.editorSlot.restoreEditor();
          yield* awaited(
            this.completeProviderAuthentication(providerId, providerName, method, previousModel),
          );
        } catch (error: unknown) {
          host.editorSlot.restoreEditor();
          const message = toErrorMessage(error);
          if (error instanceof CredentialSynchronizationError) {
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
      },
      this as unknown as LoginFlow,
    );
  }
}
