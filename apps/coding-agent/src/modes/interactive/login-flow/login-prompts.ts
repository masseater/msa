import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import config from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import ExtensionSelectorComponent from "../components/extension-selector.ts";
import LoginDialogComponent from "../components/login-dialog.ts";
import type loginDialogTypes from "../components/login-dialog.types.ts";
import type oauthSelectorTypes from "../components/oauth-selector.types.ts";
import loginFlowHelpers from "../login-flow-helpers.ts";
import type LoginFlow from "../login-flow.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { APP_NAME } = config;
const { LOGIN_CANCELLED } = loginFlowHelpers;

export default class LoginPrompts {
  private readonly flow: LoginFlow;

  constructor(flow: LoginFlow) {
    this.flow = flow;
  }

  showAmbientAuthDialog(
    providerOption: oauthSelectorTypes.AuthSelectorProvider,
    onBack?: () => void,
  ): void {
    const { host } = this.flow;
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

  select(
    title: string,
    options: string[],
    after?: loginDialogTypes.LoginDialogComponent,
  ): Promise<string> {
    const { host } = this.flow;
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

  showAuthPrompt(
    dialog: loginDialogTypes.LoginDialogComponent,
    prompt: aiTypes.AuthPrompt,
  ): Effect.Effect<string> {
    return awaitingWith(function* () {
      let response: Promise<string>;
      if (prompt.type === "select") {
        response = this.prompts.showAuthSelect(dialog, prompt);
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
    }, this.flow);
  }

  private showAuthSelect(
    dialog: loginDialogTypes.LoginDialogComponent,
    prompt: Extract<aiTypes.AuthPrompt, { type: "select" }>,
  ): Promise<string> {
    const { host } = this.flow;
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
