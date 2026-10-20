import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import MissingSessionCwdError from "../../../core/missing-session-cwd-error.ts";
import sessionCwd from "../../../core/session-cwd.ts";
import type sessionCwdTypes from "../../../core/session-cwd.types.ts";
import SessionManager from "../../../core/session-manager.ts";
import SessionSelectorComponent from "../components/session-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";
const { awaited, awaitingWith, performed } = awaitingModule;
const { formatMissingSessionCwdPrompt } = sessionCwd;

export default class SessionSelectors {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  promptForMissingSessionCwd(
    error: sessionCwdTypes.MissingSessionCwdError,
  ): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const confirmed = yield* awaited(
          this.mode.extensions.dialogs.extensionDialogs.confirm(
            "Session cwd not found",
            formatMissingSessionCwdPrompt(error.issue),
          ),
        );
        return confirmed ? error.issue.fallbackCwd : undefined;
      }, this),
    );
  }

  handleResumeSession(
    sessionPath: string,
    options?: Parameters<extensionsTypes.ExtensionCommandContext["switchSession"]>[1],
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      this.mode.display.indicator.clearStatusIndicator();
      try {
        const result = yield* awaited(
          this.mode.runtimeHost.switchSession(sessionPath, {
            projectTrustContextFactory: (cwd) =>
              this.mode.selectors.trust.createProjectTrustContext(cwd),
            withSession: options?.withSession,
          }),
        );
        if (result.cancelled) {
          return result;
        }
        this.mode.display.status.showStatus("Resumed session");
        return result;
      } catch (error: unknown) {
        if (error instanceof MissingSessionCwdError) {
          const selectedCwd = yield* awaited(this.promptForMissingSessionCwd(error));
          if (selectedCwd === undefined || selectedCwd === "") {
            this.mode.display.status.showStatus("Resume cancelled");
            return { cancelled: true };
          }
          const result = yield* awaited(
            this.mode.runtimeHost.switchSession(sessionPath, {
              cwdOverride: selectedCwd,
              projectTrustContextFactory: (cwd) =>
                this.mode.selectors.trust.createProjectTrustContext(cwd),
              withSession: options?.withSession,
            }),
          );
          if (result.cancelled) {
            return result;
          }
          this.mode.display.status.showStatus("Resumed session in current cwd");
          return result;
        }
        return yield* awaited(
          this.mode.lifecycle.fatalErrors.handleFatalRuntimeError(
            "Failed to resume session",
            error,
          ),
        );
      }
    }, this);
  }

  showSessionSelector(): void {
    this.mode.editorSlot.showSelector((done) => {
      const selector = new SessionSelectorComponent(
        (onProgress, signal) =>
          SessionManager.list(
            this.mode.sessionManager.getCwd(),
            this.mode.sessionManager.getSessionDir(),
            onProgress,
            signal,
          ),
        (onProgress, signal) =>
          this.mode.sessionManager.usesDefaultSessionDir()
            ? SessionManager.listAll(onProgress, signal)
            : SessionManager.listAll(this.mode.sessionManager.getSessionDir(), onProgress, signal),
        (sessionPath) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              yield* performed(this.handleResumeSession(sessionPath));
            }, this),
          ),
        () => {
          done();
          this.mode.ui.requestRender();
        },
        () => {
          void void this.mode.lifecycle.shutdown.shutdown();
        },
        () => this.mode.ui.requestRender(),
        {
          keybindings: this.mode.keybindings,
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

        this.mode.sessionManager.getSessionFile(),
      );
      return { component: selector, focus: selector };
    });
  }
}
