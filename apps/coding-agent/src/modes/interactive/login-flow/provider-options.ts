import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type oauthSelectorTypes from "../components/oauth-selector.types.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { CREDENTIAL_TIMEOUT_MS } = loginFlowHelpers;

export default class LoginProviderOptions {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  getProviderOptions(
    authType?: loginFlowTypes.AuthType,
  ): oauthSelectorTypes.AuthSelectorProvider[] {
    const { modelRuntime } = this.flow.host.session.models.selection;
    const options: oauthSelectorTypes.AuthSelectorProvider[] = [];
    for (const provider of modelRuntime.getProviders()) {
      const authStatus = modelRuntime.getProviderAuthStatus(provider.id);
      const source = authStatus.configured ? (authStatus.label ?? authStatus.source) : undefined;
      const status = authStatus.configured
        ? {
            type: modelRuntime.isUsingOAuth(provider.id)
              ? ("oauth" as const)
              : ("api_key" as const),
            ...(source === undefined ? {} : { source }),
          }
        : undefined;
      const subscription = provider.auth.oauth?.isSubscription === true;
      if ((authType === undefined || authType === "oauth") && provider.auth.oauth !== undefined) {
        options.push({
          authType: "oauth",
          id: provider.id,
          method: provider.auth.oauth,
          name: provider.name,
          status,
          subscription,
        });
      }
      if (
        (authType === undefined || authType === "api_key") &&
        provider.auth.apiKey !== undefined
      ) {
        options.push({
          authType: "api_key",
          id: provider.id,
          method: provider.auth.apiKey,
          name: provider.name,
          status,
          subscription,
        });
      }
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }

  *withSignedInServices(
    host: loginFlowTypes.LoginFlowHost,
    providerOptions: oauthSelectorTypes.AuthSelectorProvider[],
  ) {
    const allServices = host.session.tools.externalServices.getExternalServices();
    const statuses = yield* awaited(
      Promise.all(allServices.map((service) => service.status().catch(() => undefined))),
    );
    const services = allServices.filter((_, index) => {
      const status = statuses[index];
      return status?.installed && status.signedIn;
    });
    providerOptions = [
      ...providerOptions,
      ...services.map((service) => ({
        authType: "oauth" as const,
        id: service.id,
        name: service.name,
        status: { source: `${service.name} sign-in`, type: "oauth" as const },
      })),
    ];
    return { providerOptions, services };
  }

  getLogoutProviderOptions(): Effect.Effect<oauthSelectorTypes.AuthSelectorProvider[]> {
    return awaitingWith(function* () {
      const { modelRuntime } = this.host.session.models.selection;
      const credentials = yield* awaited(
        modelRuntime.listCredentials({
          signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
        }),
      );
      return credentials
        .map(({ providerId, type }) => {
          const provider = modelRuntime.getProvider(providerId);
          return {
            authType: type,
            id: providerId,
            name: provider?.name ?? providerId,
            status: { source: "stored credential", type },
            subscription: provider?.auth.oauth?.isSubscription === true,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }, this.flow);
  }
}
