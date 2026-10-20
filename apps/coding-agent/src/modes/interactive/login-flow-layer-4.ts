import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type externalServicesTypes from "../../core/external-services.types.ts";
import errorsModule from "../../utils/errors.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer3 from "./login-flow-layer-3.ts";
import type LoginFlow from "./login-flow.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaitingWith } = awaitingModule;
const { theme } = themeModule;
const { toErrorMessage } = errorsModule;
const { LOGIN_CANCELLED } = loginFlowHelpers;

export default abstract class LoginFlowLayer4 extends LoginFlowLayer3 {
  protected loginService(
    service: externalServicesTypes.ExternalService,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        const { host } = this;
        const { status, dialog } = yield* this.loginServicePart1(service, host, onBack);
        if (status !== undefined && !status.installed) {
          dialog.showInfo(
            `${service.name} provides ${service.purpose}. Install it first, then run /login ${service.id}:`,
            [],
          );
          dialog.showDetails([theme.fg("accent", `  ${status.install}`)]);
          dialog.showInfo("", [], true);
          return;
        }
        dialog.showWaiting(`Signing in to ${service.name}…`);
        host.programStatus.setBlocked("login", {
          kind: "auth",
          message: `Log in to ${service.name}`,
        });
        try {
          yield* awaited(
            service.login(
              {
                prompt: (message, placeholder) => dialog.showPrompt(message, placeholder),
                select: (title, options) => this.select(title, options, dialog),
                showPage: (page) => {
                  dialog.showDetails([theme.fg("text", "Open this page to sign in:")]);
                  dialog.showInfo("", [{ url: page.url }]);
                  if (page.code !== undefined && page.code !== "") {
                    dialog.showInfo(`The page shows this code; check it matches: ${page.code}`);
                  }
                  dialog.showWaiting("Waiting for you to approve the sign-in…");
                },
              },
              dialog.signal,
            ),
          );
          host.editorSlot.restoreEditor();
          host.session.tools.externalServices.refreshExternalServiceTools();
          host.showStatus(`Signed in to ${service.name}; ${service.purpose} is available.`);
        } catch (error: unknown) {
          host.editorSlot.restoreEditor();
          const message = toErrorMessage(error);
          if (dialog.signal.aborted || message === LOGIN_CANCELLED) onBack?.();
          else host.showError(`Failed to sign in to ${service.name}: ${message}`);
        } finally {
          host.programStatus.setBlocked("login", undefined);
        }
      },
      this as unknown as LoginFlow,
    );
  }
}
