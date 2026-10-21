import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import config from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import crashLog from "../../../core/crash-log.ts";
import type crashLogTypes from "../../../core/crash-log.types.ts";
import platform from "../../../core/platform/index.ts";
import handoffResume from "../handoff-resume.ts";
import type InteractiveMode from "../interactive-mode.ts";
import tmuxKeyboard from "./tmux-keyboard.ts";

const { APP_NAME } = config;
const { takeUnnotifiedCrash } = crashLog;
const { awaited, awaitingWith, performed } = awaitingModule;
const { toDate } = platform;
const { offerHandoff } = handoffResume;
const { checkTmuxKeyboardSetup } = tmuxKeyboard;

export default class ModeRunLoop {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private warnAboutTmuxKeyboard(): void {
    Effect.runFork(
      awaitingWith(function* () {
        const warning = yield* awaited(checkTmuxKeyboardSetup());
        if (warning !== undefined && warning !== "") {
          this.mode.display.status.showWarning(warning);
        }
      }, this),
    );
  }

  private showStartupDiagnostics(): void {
    const { migratedProviders, startupDiagnostics, modelFallbackMessage } = this.mode.options;
    const { status } = this.mode.display;
    for (const diagnostic of startupDiagnostics ?? []) {
      if (diagnostic.type === "error") {
        status.showError(diagnostic.message);
      } else if (diagnostic.type === "warning") {
        status.showWarning(diagnostic.message);
      } else {
        status.showStatus(diagnostic.message);
      }
    }
    if (migratedProviders !== undefined && migratedProviders.length > 0) {
      status.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
    }
    const modelsJsonError = this.mode.session.models.selection.modelRuntime.getError();
    if (modelsJsonError !== undefined && modelsJsonError !== "") {
      status.showError(`models.json error: ${modelsJsonError}`);
    }
    if (modelFallbackMessage !== undefined && modelFallbackMessage !== "") {
      status.showWarning(modelFallbackMessage);
    }
  }

  runInputLoop(
    crash: crashLogTypes.CrashRecord | undefined,
    initialMessage: string | undefined,
    initialImages: compatTypes.ImageContent[] | undefined,
    initialMessages: string[] | undefined,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (crash !== undefined) {
        const when = toDate(crash.timestamp).toLocaleString();
        this.mode.display.status.showWarning(
          `${APP_NAME} crashed on ${when} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`,
        );
      }
      const hasInitialMessage = initialMessage !== undefined && initialMessage !== "";
      if (!hasInitialMessage && (initialMessages === undefined || initialMessages.length === 0)) {
        try {
          yield* awaited(
            offerHandoff(this.mode.session, this.mode.extensions.dialogs.extensionDialogs),
          );
        } catch (error: unknown) {
          this.mode.display.status.showError(
            error instanceof Error ? error.message : "Unknown error occurred",
          );
        }
      }
      if (hasInitialMessage)
        yield* performed(
          this.mode.input.submit.promptReportingErrors(initialMessage, { images: initialImages }),
        );
      for (const message of initialMessages ?? [])
        yield* performed(this.mode.input.submit.promptReportingErrors(message));
      while (true) {
        const userInput = yield* awaited(this.mode.input.submit.getUserInput());
        yield* performed(this.mode.input.submit.promptReportingErrors(userInput));
      }
    }, this);
  }

  run(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.mode.lifecycle.startup.init());
        this.mode.lifecycle.backgroundChecks.start();
        this.warnAboutTmuxKeyboard();
        this.showStartupDiagnostics();
        const { initialImages, initialMessage, initialMessages } = this.mode.options;
        const crash = yield* awaited(takeUnnotifiedCrash());
        yield* performed(this.runInputLoop(crash, initialMessage, initialImages, initialMessages));
      }, this),
    );
  }
}
