import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type externalServicesTypes from "../../core/external-services.types.ts";
import errorsModule from "../../utils/errors.ts";
import ExtensionSelectorComponent from "./components/extension-selector.ts";
import type loginDialogTypes from "./components/login-dialog.types.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer1 from "./login-flow-layer-1.ts";
import type LoginFlow from "./login-flow.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { LOGIN_CANCELLED, notifyAuthDialog } = loginFlowHelpers;

export default abstract class LoginFlowLayer2 extends LoginFlowLayer1 {
  protected select(
    title: string,
    options: string[],
    after?: loginDialogTypes.LoginDialogComponent,
  ): Promise<string> {
    const { host } = this;
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        host.editorSlot.showSelector((done) => {
          const finish = () => {
            done();
            if (after !== undefined) host.editorSlot.show(after);
          };
          const selector = new ExtensionSelectorComponent(
            title,
            options,
            (option) => {
              finish();
              resume(Effect.succeed(option));
            },
            () => {
              finish();
              resume(Effect.die(new Error(LOGIN_CANCELLED)));
            },
          );
          return { component: selector, focus: selector };
        });
      }),
    );
  }

  protected logoutService(service: externalServicesTypes.ExternalService): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        const { host } = this;
        try {
          yield* awaited(
            service.logout({ select: (title, options) => this.select(title, options) }),
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
      },
      this as unknown as LoginFlow,
    );
  }

  protected loginProvider(
    dialog: loginDialogTypes.LoginDialogComponent,
    providerId: string,
    providerName: string,
    method: loginFlowTypes.AuthType,
  ): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        const { host } = this;
        host.programStatus.setBlocked("login", {
          kind: "auth",
          message: `Log in to ${providerName}`,
        });
        try {
          yield* awaited(
            host.session.modelRuntime.login(
              providerId,
              method,
              {
                notify: (event) => notifyAuthDialog(dialog, event),
                prompt: (prompt) => Effect.runPromise(this.showAuthPrompt(dialog, prompt)),
                signal: dialog.signal,
              },
              { getDeviceId: () => host.session.settingsManager.getOrCreateDeviceId() },
            ),
          );
        } finally {
          host.programStatus.setBlocked("login", undefined);
        }
      },
      this as unknown as LoginFlow,
    );
  }

  protected showAuthPrompt(
    dialog: loginDialogTypes.LoginDialogComponent,
    prompt: aiTypes.AuthPrompt,
  ): Effect.Effect<string> {
    return awaitingWith(
      function* () {
        let response: Promise<string>;
        if (prompt.type === "select") {
          response = this.showAuthSelect(dialog, prompt);
        } else if (prompt.type === "manual_code") {
          response = dialog.showManualInput(prompt.message);
        } else {
          response = dialog.showPrompt(prompt.message, prompt.placeholder);
        }
        if (prompt.signal === undefined) return yield* awaited(response);
        if (prompt.signal.aborted) throw new Error(LOGIN_CANCELLED);
        const signal = prompt.signal;
        const aborted = Effect.callback<string>((resume) => {
          const onAbort = () => resume(Effect.die(new Error(LOGIN_CANCELLED)));
          signal.addEventListener("abort", onAbort, { once: true });
          return Effect.sync(() => signal.removeEventListener("abort", onAbort));
        });
        return yield* performed(
          Effect.raceFirst(
            Effect.promise(() => response),
            aborted,
          ),
        );
      },
      this as unknown as LoginFlow,
    );
  }

  protected showAuthSelect(
    dialog: loginDialogTypes.LoginDialogComponent,
    prompt: Extract<aiTypes.AuthPrompt, { type: "select" }>,
  ): Promise<string> {
    const { host } = this;
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        const selector = new ExtensionSelectorComponent(
          prompt.message,
          prompt.options.map((option) => option.label),
          (optionLabel) => {
            host.editorSlot.show(dialog);
            const id = prompt.options.find((option) => option.label === optionLabel)?.id;
            if (id !== undefined && id !== "") resume(Effect.succeed(id));
            else resume(Effect.die(new Error(LOGIN_CANCELLED)));
          },
          () => {
            host.editorSlot.show(dialog);
            resume(Effect.die(new Error(LOGIN_CANCELLED)));
          },
        );
        host.editorSlot.show(selector);
      }),
    );
  }
}
