import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import externalServices from "../../core/external-services.ts";
import ExtensionSelectorComponent from "./components/extension-selector.ts";
import LoginFlowLayer7 from "./login-flow-layer-7.ts";
import type LoginFlow from "./login-flow.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { findExternalService } = externalServices;

export default abstract class LoginFlowLayer8 extends LoginFlowLayer7 {
  login(providerRef?: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          const normalizedRef = providerRef?.trim().toLowerCase();
          if (normalizedRef === undefined || normalizedRef === "") {
            this.showAuthTypeSelector();
            return;
          }
          const service = findExternalService(
            this.host.session.tools.externalServices.getExternalServices(),
            normalizedRef,
          );
          if (service !== undefined) {
            yield* performed(this.loginService(service));
            return;
          }

          const providerOptions = this.getProviderOptions().filter(
            (provider) =>
              provider.id.toLowerCase() === normalizedRef ||
              provider.name.toLowerCase() === normalizedRef,
          );
          if (providerOptions.length === 1) {
            yield* performed(this.startProviderLogin(providerOptions[0]!));
            return;
          }
          if (new Set(providerOptions.map((provider) => provider.id)).size === 1) {
            this.showAuthTypeSelector(providerOptions);
            return;
          }
          this.showProviderSelector(undefined, providerRef);
        },
        this as unknown as LoginFlow,
      ),
    );
  }

  showServiceSelector(): Effect.Effect<void> {
    return awaitingWith(
      function* () {
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
                  this.loginService(
                    entry.service,
                    () => void Effect.runFork(this.showServiceSelector()),
                  ),
                );
            },
            () => {
              done();
              this.showAuthTypeSelector();
            },
          );
          return { component: selector, focus: selector };
        });
      },
      this as unknown as LoginFlow,
    );
  }
}
