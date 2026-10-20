import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import type externalServicesTypes from "../../core/external-services.types.ts";
import LoginDialogComponent from "./components/login-dialog.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer0 from "./login-flow-layer-0.ts";
import type LoginFlow from "./login-flow.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { APP_NAME } = config;
const { CREDENTIAL_TIMEOUT_MS, completeProviderAuthenticationPart2 } = loginFlowHelpers;

export default abstract class LoginFlowLayer1 extends LoginFlowLayer0 {
  getProviderOptions(
    authType?: loginFlowTypes.AuthType,
  ): oauthSelectorTypes.AuthSelectorProvider[] {
    const { modelRuntime } = this.host.session.models.selection;
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

  protected *logoutPart2(
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

  protected getLogoutProviderOptions(): Effect.Effect<oauthSelectorTypes.AuthSelectorProvider[]> {
    return awaitingWith(
      function* () {
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
      },
      this as unknown as LoginFlow,
    );
  }

  protected *loginServicePart1(
    service: externalServicesTypes.ExternalService,
    host: loginFlowTypes.LoginFlowHost,
    onBack: (() => void) | undefined,
  ) {
    const status = yield* awaited(service.status().catch(() => undefined));
    const dialog = new LoginDialogComponent(
      host.ui,
      service.id,
      () => {
        host.editorSlot.restoreEditor();
        onBack?.();
      },
      service.name,
    );
    host.editorSlot.show(dialog);
    return { dialog, status };
  }

  protected *completeProviderAuthenticationPart4(
    deferSelection: boolean,
    host: loginFlowTypes.LoginFlowHost,
    actionLabel: string,
    finishAuthentication: () => Promise<void>,
  ) {
    yield* this.completeProviderAuthenticationPart3(
      deferSelection,
      host,
      actionLabel,
      finishAuthentication,
    );
  }

  protected *completeProviderAuthenticationPart3(
    deferSelection: boolean,
    host: loginFlowTypes.LoginFlowHost,
    actionLabel: string,
    finishAuthentication: () => Promise<void>,
  ) {
    yield* performed(
      completeProviderAuthenticationPart2(deferSelection, host, actionLabel, finishAuthentication),
    );
  }

  protected showAmbientAuthDialog(
    providerOption: oauthSelectorTypes.AuthSelectorProvider,
    onBack?: () => void,
  ): void {
    const { host } = this;
    const dialog = new LoginDialogComponent(
      host.ui,
      providerOption.id,
      () => {
        host.editorSlot.restoreEditor();
        onBack?.();
      },
      providerOption.name,
      `${providerOption.name} setup`,
    );
    dialog.showInfo(
      `${providerOption.method?.name ?? "Authentication"} is configured outside ${APP_NAME}.`,
      [],
      true,
    );
    host.editorSlot.show(dialog);
  }
}
