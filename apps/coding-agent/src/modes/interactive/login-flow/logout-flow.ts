import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import CredentialSynchronizationError from "../../../core/credential-synchronization-error.ts";
import type externalServicesTypes from "../../../core/external-services.types.ts";
import errorsModule from "../../../utils/errors.ts";
import OAuthSelectorComponent from "../components/oauth-selector.ts";
import type oauthSelectorTypes from "../components/oauth-selector.types.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { CREDENTIAL_TIMEOUT_MS, LOGIN_CANCELLED } = loginFlowHelpers;
const { toErrorMessage } = errorsModule;

export default class LogoutFlow {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  private logoutService(service: externalServicesTypes.ExternalService): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      try {
        yield* awaited(
          service.logout({ select: (title, options) => this.prompts.select(title, options) }),
        );
        host.showStatus(
          `Signed out of ${service.name}. Its tools stay registered until /reload or a new session.`,
        );
      } catch (error: unknown) {
        const message = toErrorMessage(error);
        if (message !== LOGIN_CANCELLED) {
          host.showError(`Failed to sign out of ${service.name}: ${message}`);
        }
      }
    }, this.flow);
  }

  logout(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { host } = this;
        let providerOptions: oauthSelectorTypes.AuthSelectorProvider[];
        try {
          providerOptions = yield* performed(this.providers.getLogoutProviderOptions());
        } catch (error) {
          host.showError(`Could not read stored credentials: ${toErrorMessage(error)}`);
          return;
        }
        let services;
        ({ services, providerOptions } = yield* this.providers.withSignedInServices(
          host,
          providerOptions,
        ));
        if (providerOptions.length === 0) {
          host.showStatus(
            "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
          );
          return;
        }

        this.logouts.showLogoutSelector(host, providerOptions, services);
      }, this.flow),
    );
  }

  private showLogoutSelector(
    host: loginFlowTypes.LoginFlowHost,
    providerOptions: oauthSelectorTypes.AuthSelectorProvider[],
    services: externalServicesTypes.ExternalService[],
  ): void {
    host.editorSlot.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        "logout",
        providerOptions,
        (providerId: string) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              const providerOption = providerOptions.find((provider) => provider.id === providerId);
              if (providerOption === undefined) {
                return;
              }
              const service = services.find((candidate) => candidate.id === providerId);
              if (service !== undefined) {
                yield* performed(this.logouts.logoutService(service));
                return;
              }
              yield* this.logouts.logoutProvider(host, providerOption);
            }, this.flow),
          ),
        () => {
          done();
          host.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private *logoutProvider(
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
