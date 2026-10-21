import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import externalServices from "../../../core/external-services.ts";
import type externalServicesTypes from "../../../core/external-services.types.ts";
import errorsModule from "../../../utils/errors.ts";
import LoginDialogComponent from "../components/login-dialog.ts";
import type loginDialogTypes from "../components/login-dialog.types.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";
import themeModule from "../theme/theme.ts";

const { awaited, awaitingWith } = awaitingModule;
const { LOGIN_CANCELLED } = loginFlowHelpers;
const { toErrorMessage } = errorsModule;
const { theme } = themeModule;
const { findExternalService } = externalServices;

export default class ServiceLogin {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  private *showServiceLoginDialog(
    service: externalServicesTypes.ExternalService,
    onBack: (() => void) | undefined,
  ) {
    const { host } = this.flow;
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

  loginService(
    service: externalServicesTypes.ExternalService,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const { status, dialog } = yield* this.services.showServiceLoginDialog(service, onBack);
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
        yield* awaited(service.login(this.services.serviceLoginPrompts(dialog), dialog.signal));
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
    }, this.flow);
  }

  private serviceLoginPrompts(
    dialog: loginDialogTypes.LoginDialogComponent,
  ): Parameters<externalServicesTypes.ExternalService["login"]>[0] {
    return {
      prompt: (message, placeholder) => dialog.showPrompt(message, placeholder),
      select: (title, options) => this.flow.prompts.select(title, options, dialog),
      showPage: (page) => {
        dialog.showDetails([theme.fg("text", "Open this page to sign in:")]);
        dialog.showInfo("", [{ url: page.url }]);
        if (page.code !== undefined && page.code !== "") {
          dialog.showInfo(`The page shows this code; check it matches: ${page.code}`);
        }
        dialog.showWaiting("Waiting for you to approve the sign-in…");
      },
    };
  }

  serviceByRef(ref: string): externalServicesTypes.ExternalService | undefined {
    return findExternalService(
      this.flow.host.session.tools.externalServices.getExternalServices(),
      ref,
    );
  }
}
