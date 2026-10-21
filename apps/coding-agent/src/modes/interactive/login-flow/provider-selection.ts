import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import ExtensionSelectorComponent from "../components/extension-selector.ts";
import OAuthSelectorComponent from "../components/oauth-selector.ts";
import type oauthSelectorTypes from "../components/oauth-selector.types.ts";
import type LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;

export default class ProviderSelection {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  showAuthTypeSelector(providerOptions?: oauthSelectorTypes.AuthSelectorProvider[]): void {
    const { host } = this.flow;
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
        void Effect.runFork(this.flow.providerLogin.startProviderLogin(providerOption));
      }
      return;
    }

    const title =
      providerOptions?.[0] === undefined
        ? "Select authentication method:"
        : `Select authentication method for ${providerOptions[0].name}:`;
    this.showAuthTypeChoices(
      host,
      serviceLabel,
      subscriptionLabel,
      providerOptions,
      title,
      options,
    );
  }

  showProviderSelector(authType?: loginFlowTypes.AuthType, initialSearchInput?: string): void {
    const { host } = this.flow;
    const providerOptions = this.flow.providers.getProviderOptions(authType);
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
            awaitingWith(function* () {
              done();
              const providerOption = providerOptions.find(
                (provider) => provider.id === providerId && provider.authType === selectedAuthType,
              );
              if (providerOption === undefined) {
                return;
              }
              yield* performed(
                this.providerLogin.startProviderLogin(providerOption, () =>
                  this.selection.showProviderSelector(authType, initialSearchInput),
                ),
              );
            }, this.flow),
          ),
        () => {
          this.providerSelectorBack(done, authType, host);
        },
        initialSearchInput,
      );
      return { component: selector, focus: selector };
    });
  }

  private providerSelectorBack(
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

  private showAuthTypeChoices(
    host: loginFlowTypes.LoginFlowHost,
    serviceLabel: "Sign in to a service" | undefined,
    subscriptionLabel: string,
    providerOptions: oauthSelectorTypes.AuthSelectorProvider[] | undefined,
    title: string,
    options: string[],
  ): void {
    host.editorSlot.showSelector((done) => {
      const onSelect = (option: string) => {
        done();
        if (option === serviceLabel) {
          void Effect.runFork(this.showServiceSelector());
          return;
        }
        const authType = option === subscriptionLabel ? "oauth" : "api_key";
        if (providerOptions === undefined) {
          this.showProviderSelector(authType);
          return;
        }
        const providerOption = providerOptions.find((provider) => provider.authType === authType);
        if (providerOption !== undefined) {
          void Effect.runFork(
            this.flow.providerLogin.startProviderLogin(providerOption, () =>
              this.showAuthTypeSelector(providerOptions),
            ),
          );
        }
      };
      const onCancel = () => {
        done();
        host.ui.requestRender();
      };
      const selector = new ExtensionSelectorComponent(title, options, onSelect, onCancel);
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }

  showServiceSelector(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const services = host.session.tools.externalServices.getExternalServices();
      const statuses = yield* awaited(
        Promise.all(services.map((service) => service.status().catch(() => undefined))),
      );
      const entries = services.map((service, index) => {
        const status = statuses[index];
        const state =
          status === undefined
            ? ""
            : status.installed
              ? status.signedIn
                ? "signed in"
                : ""
              : "not installed";
        return {
          label: `${service.name} · ${service.purpose}${state === "" ? "" : ` (${state})`}`,
          service,
        };
      });
      host.editorSlot.showSelector((done) => {
        const selector = new ExtensionSelectorComponent(
          "Select a service to sign in to:",
          entries.map((entry) => entry.label),
          (option) => {
            done();
            const entry = entries.find((candidate) => candidate.label === option);
            if (entry !== undefined)
              void Effect.runFork(
                this.services.loginService(
                  entry.service,
                  () => void Effect.runFork(this.selection.showServiceSelector()),
                ),
              );
          },
          () => {
            done();
            this.selection.showAuthTypeSelector();
          },
        );
        return { component: selector, focus: selector };
      });
    }, this.flow);
  }
}
