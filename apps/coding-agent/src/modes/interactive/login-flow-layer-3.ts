import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import CredentialSynchronizationError from "../../core/credential-synchronization-error.ts";
import errorsModule from "../../utils/errors.ts";
import OAuthSelectorComponent from "./components/oauth-selector.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer2 from "./login-flow-layer-2.ts";
import type LoginFlow from "./login-flow.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { CREDENTIAL_TIMEOUT_MS } = loginFlowHelpers;

export default abstract class LoginFlowLayer3 extends LoginFlowLayer2 {
  logout(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          const { host } = this;
          let providerOptions: oauthSelectorTypes.AuthSelectorProvider[];
          try {
            providerOptions = yield* performed(this.getLogoutProviderOptions());
          } catch (error) {
            host.showError(`Could not read stored credentials: ${toErrorMessage(error)}`);
            return;
          }
          let services;
          ({ services, providerOptions } = yield* this.logoutPart2(host, providerOptions));
          if (providerOptions.length === 0) {
            host.showStatus(
              "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
            );
            return;
          }

          host.editorSlot.showSelector((done) => {
            const selector = new OAuthSelectorComponent(
              "logout",
              providerOptions,
              (providerId: string) =>
                Effect.runPromise(
                  awaitingWith(
                    function* () {
                      done();
                      const providerOption = providerOptions.find(
                        (provider) => provider.id === providerId,
                      );
                      if (providerOption === undefined) {
                        return;
                      }
                      const service = services.find((candidate) => candidate.id === providerId);
                      if (service !== undefined) {
                        yield* performed(this.logoutService(service));
                        return;
                      }
                      yield* this.logoutPart1(host, providerOption);
                    },
                    this as unknown as LoginFlow,
                  ),
                ),
              () => {
                done();
                host.ui.requestRender();
              },
            );
            return { component: selector, focus: selector };
          });
        },
        this as unknown as LoginFlow,
      ),
    );
  }

  protected *logoutPart1(
    host: loginFlowTypes.LoginFlowHost,
    providerOption: oauthSelectorTypes.AuthSelectorProvider,
  ) {
    try {
      yield* awaited(
        host.session.models.selection.modelRuntime.logout(providerOption.id, {
          signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
        }),
      );
      host.refreshAuthState();
      host.showStatus(
        providerOption.authType === "oauth"
          ? `Logged out of ${providerOption.name}`
          : `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`,
      );
    } catch (error: unknown) {
      host.showError(
        error instanceof CredentialSynchronizationError
          ? `Credentials removed for ${providerOption.name}, but local model state could not be synchronized: ${toErrorMessage(error)}`
          : `Logout failed: ${toErrorMessage(error)}`,
      );
    }
  }
}
