import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type loginFlowTypes from "./login-flow.types.ts";
import LoginPrompts from "./login-flow/login-prompts.ts";
import LogoutFlow from "./login-flow/logout-flow.ts";
import ProviderAuthentication from "./login-flow/provider-authentication.ts";
import ProviderLogin from "./login-flow/provider-login.ts";
import LoginProviderOptions from "./login-flow/provider-options.ts";
import ProviderSelection from "./login-flow/provider-selection.ts";
import ServiceLogin from "./login-flow/service-login.ts";

const { awaitingWith, performed } = awaitingModule;

export default class LoginFlow {
  readonly providers: LoginProviderOptions;
  readonly prompts: LoginPrompts;
  readonly logouts: LogoutFlow;
  readonly services: ServiceLogin;
  readonly providerLogin: ProviderLogin;
  readonly selection: ProviderSelection;
  readonly authentication: ProviderAuthentication;

  host!: loginFlowTypes.LoginFlowHost;

  login(providerRef?: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const normalizedRef = providerRef?.trim().toLowerCase();
        if (normalizedRef === undefined || normalizedRef === "") {
          this.selection.showAuthTypeSelector();
          return;
        }
        const service = this.services.serviceByRef(normalizedRef);
        if (service !== undefined) {
          yield* performed(this.services.loginService(service));
          return;
        }

        const providerOptions = this.providers
          .getProviderOptions()
          .filter(
            (provider) =>
              provider.id.toLowerCase() === normalizedRef ||
              provider.name.toLowerCase() === normalizedRef,
          );
        if (providerOptions.length === 1) {
          yield* performed(this.providerLogin.startProviderLogin(providerOptions[0]!));
          return;
        }
        if (new Set(providerOptions.map((provider) => provider.id)).size === 1) {
          this.selection.showAuthTypeSelector(providerOptions);
          return;
        }
        this.selection.showProviderSelector(undefined, providerRef);
      }, this),
    );
  }

  constructor(host: loginFlowTypes.LoginFlowHost) {
    this.providers = new LoginProviderOptions(this);
    this.prompts = new LoginPrompts(this);
    this.logouts = new LogoutFlow(this);
    this.services = new ServiceLogin(this);
    this.providerLogin = new ProviderLogin(this);
    this.selection = new ProviderSelection(this);
    this.authentication = new ProviderAuthentication(this);
    this.host = host;
  }
}
