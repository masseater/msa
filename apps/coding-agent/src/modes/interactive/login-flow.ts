import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import modelResolver from "../../core/model-resolver.ts";
import ExtensionSelectorComponent from "./components/extension-selector.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer8 from "./login-flow-layer-8.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { defaultModelPerProvider } = modelResolver;
const { hasDefaultModelProvider, isUnknownModel } = loginFlowHelpers;

export default class LoginFlow extends LoginFlowLayer8 {
  static showAuthTypeSelectorPart1(
    self: LoginFlow,
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
          void Effect.runFork(self.showServiceSelector());
          return;
        }
        const authType = option === subscriptionLabel ? "oauth" : "api_key";
        if (providerOptions === undefined) {
          self.showProviderSelector(authType);
          return;
        }
        const providerOption = providerOptions.find((provider) => provider.authType === authType);
        if (providerOption !== undefined) {
          void Effect.runFork(
            self.startProviderLogin(providerOption, () =>
              self.showAuthTypeSelector(providerOptions),
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

  static completeProviderAuthenticationHost(
    self: LoginFlow,
    authType: "oauth" | "api_key",
    providerName: string,
    previousModel: compatTypes.Model<any> | undefined,
    providerId: string,
  ): {
    host: loginFlowTypes.LoginFlowHost;
    actionLabel: string;
    deferSelection: boolean;
    session: agentSessionTypes.AgentSession;
  } {
    const { host } = self;
    const actionLabel =
      authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

    const session = host.session;
    const deferSelection =
      isUnknownModel(previousModel) &&
      hasDefaultModelProvider(providerId) &&
      !session.models.selection.modelRuntime
        .getAvailableSnapshot()
        .some(
          (model) =>
            model.provider === providerId && model.id === defaultModelPerProvider[providerId],
        );
    return { actionLabel, deferSelection, host, session };
  }
}
