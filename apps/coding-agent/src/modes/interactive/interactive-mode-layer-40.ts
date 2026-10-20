import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import type crashLogTypes from "../../core/crash-log.types.ts";
import platformModule from "../../core/platform.ts";
import SessionManager from "../../core/session-manager.ts";
import SessionSelectorComponent from "./components/session-selector.ts";
import handoffResume from "./handoff-resume.ts";
import InteractiveModeLayer39 from "./interactive-mode-layer-39.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toDate } = platformModule;
const { APP_NAME } = config;
const { offerHandoff } = handoffResume;

export default abstract class InteractiveModeLayer40 extends InteractiveModeLayer39 {
  protected runPart3(
    crash: crashLogTypes.CrashRecord | undefined,
    initialMessage: string | undefined,
    initialImages: compatTypes.ImageContent[] | undefined,
    initialMessages: string[] | undefined,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (crash !== undefined) {
        const when = toDate(crash.timestamp).toLocaleString();
        this.showWarning(
          `${APP_NAME} crashed on ${when} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`,
        );
      }
      const hasInitialMessage = initialMessage !== undefined && initialMessage !== "";
      if (!hasInitialMessage && (initialMessages === undefined || initialMessages.length === 0)) {
        try {
          yield* awaited(offerHandoff(this.session, this.extensionDialogs));
        } catch (error: unknown) {
          this.showError(error instanceof Error ? error.message : "Unknown error occurred");
        }
      }
      if (hasInitialMessage)
        yield* performed(this.promptReportingErrors(initialMessage, { images: initialImages }));
      for (const message of initialMessages ?? [])
        yield* performed(this.promptReportingErrors(message));
      while (true) {
        const userInput = yield* awaited(this.getUserInput());
        yield* performed(this.promptReportingErrors(userInput));
      }
    }, this);
  }

  protected showSessionSelector(): void {
    this.editorSlot.showSelector((done) => {
      const selector = new SessionSelectorComponent(
        (onProgress, signal) =>
          SessionManager.list(
            this.sessionManager.getCwd(),
            this.sessionManager.getSessionDir(),
            onProgress,
            signal,
          ),
        (onProgress, signal) =>
          this.sessionManager.usesDefaultSessionDir()
            ? SessionManager.listAll(onProgress, signal)
            : SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress, signal),
        (sessionPath) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              yield* performed(this.handleResumeSession(sessionPath));
            }, this),
          ),
        () => {
          done();
          this.ui.requestRender();
        },
        () => {
          void void this.shutdown();
        },
        () => this.ui.requestRender(),
        {
          keybindings: this.keybindings,
          renameSession: (sessionFilePath: string, nextName: string | undefined) =>
            Effect.runPromise(
              Effect.sync(() => {
                const next = (nextName ?? "").trim();
                if (next === "") return;
                const mgr = SessionManager.open(sessionFilePath);
                mgr.appendSessionInfo(next);
              }),
            ),
          showRenameHint: true,
        },

        this.sessionManager.getSessionFile(),
      );
      return { component: selector, focus: selector };
    });
  }
}
