import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import ProjectTrustStore from "../../core/project-trust-store.ts";
import sessionCwd from "../../core/session-cwd.ts";
import type sessionCwdTypes from "../../core/session-cwd.types.ts";
import trustManager from "../../core/trust-manager.ts";
import errorsModule from "../../utils/errors.ts";
import UserMessageSelectorComponent from "./components/user-message-selector.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer13 from "./interactive-mode-layer-13.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { formatMissingSessionCwdPrompt } = sessionCwd;
const { toErrorMessage } = errorsModule;
const { hasTrustRequiringProjectResources } = trustManager;

export default abstract class InteractiveModeLayer14 extends InteractiveModeLayer13 {
  protected promptForMissingSessionCwd(
    error: sessionCwdTypes.MissingSessionCwdError,
  ): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const confirmed = yield* awaited(
          this.extensionDialogs.confirm(
            "Session cwd not found",
            formatMissingSessionCwdPrompt(error.issue),
          ),
        );
        return confirmed ? error.issue.fallbackCwd : undefined;
      }, this),
    );
  }

  protected submitWhileBusy(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (this.session.compaction.manual.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          yield* awaited(this.session.run.prompting.prompt(text));
        } else this.queueCompactionMessage(text, "steer");
        return true;
      }
      if (!this.session.isStreaming) return false;
      this.editor.addToHistory?.(text);
      this.editor.setText("");
      yield* awaited(this.session.run.prompting.prompt(text, { streamingBehavior: "steer" }));
      this.updatePendingMessagesDisplay();
      this.ui.requestRender();
      return true;
    }, this);
  }

  protected handleFollowUp(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
      if (text === "") return;

      if (this.session.compaction.manual.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          yield* awaited(this.session.run.prompting.prompt(text));
        } else {
          this.queueCompactionMessage(text, "followUp");
        }
        return;
      }

      if (this.session.isStreaming) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        yield* awaited(this.session.run.prompting.prompt(text, { streamingBehavior: "followUp" }));
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
      } else if (this.editor.onSubmit !== undefined) {
        this.editor.setText("");
        this.editor.onSubmit(text);
      }
    }, this);
  }

  protected flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.compactionQueuedMessages.length === 0) {
          return;
        }

        const { queuedMessages, restoreQueue } = this.flushCompactionQueueQueuedMessages();

        const flushCompactionQueuePart12Result = yield* performed(
          this.flushCompactionQueuePart12(options, queuedMessages, restoreQueue),
        );
        if (flushCompactionQueuePart12Result.done) return flushCompactionQueuePart12Result.value;
      }, this),
    );
  }

  protected flushCompactionQueuePart12(
    options: { willRetry?: boolean } | undefined,
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{ done: true; value: void } | { done: false; value: void }> {
    return awaitingWith(function* () {
      try {
        if (options?.willRetry === true) {
          for (const message of queuedMessages) {
            if (this.isExtensionCommand(message.text)) {
              yield* awaited(this.session.run.prompting.prompt(message.text));
            } else if (message.mode === "followUp") {
              yield* awaited(this.session.run.queue.followUp(message.text));
            } else {
              yield* awaited(this.session.run.queue.steer(message.text));
            }
          }
          this.updatePendingMessagesDisplay();
          return { done: true, value: undefined };
        }

        const firstPromptIndex = queuedMessages.findIndex(
          (message) => !this.isExtensionCommand(message.text),
        );
        const firstPrompt = queuedMessages[firstPromptIndex];
        if (firstPrompt === undefined) {
          for (const message of queuedMessages) {
            yield* awaited(this.session.run.prompting.prompt(message.text));
          }
          return { done: true, value: undefined };
        }

        yield* performed(
          this.flushCompactionQueuePart1(
            queuedMessages,
            firstPromptIndex,
            firstPrompt,
            restoreQueue,
          ),
        );
      } catch (error) {
        restoreQueue(error);
      }
      return { done: false, value: undefined };
    }, this);
  }

  protected flushCompactionQueuePart1(
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: interactiveModeInternalTypes.CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { rest, promptPromise } = yield* performed(
        this.flushCompactionQueueRest(queuedMessages, firstPromptIndex, firstPrompt, restoreQueue),
      );

      yield* performed(this.flushCompactionQueuePart3(rest, promptPromise));
    }, this);
  }

  protected flushCompactionQueueQueuedMessages(): {
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[];
    restoreQueue: (error: unknown) => void;
  } {
    const queuedMessages = [...this.compactionQueuedMessages];
    this.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.session.run.queue.clearQueue();
      this.compactionQueuedMessages = queuedMessages;
      this.updatePendingMessagesDisplay();
      this.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${toErrorMessage(
          error,
        )}`,
      );
    };
    return { queuedMessages, restoreQueue };
  }

  protected flushCompactionQueuePart3(
    rest: interactiveModeInternalTypes.CompactionQueuedMessage[],
    promptPromise: Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      for (const message of rest) {
        if (this.isExtensionCommand(message.text)) {
          yield* awaited(this.session.run.prompting.prompt(message.text));
        } else if (message.mode === "followUp") {
          yield* awaited(this.session.run.queue.followUp(message.text));
        } else {
          yield* awaited(this.session.run.queue.steer(message.text));
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    }, this);
  }

  protected maybeSaveImplicitProjectTrustAfterReload(): boolean {
    const cwd = this.sessionManager.getCwd();
    if (this.autoTrustOnReloadCwd !== cwd) {
      return false;
    }
    if (!this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
      return false;
    }

    const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
    try {
      if (trustStore.get(cwd) !== null) {
        this.autoTrustOnReloadCwd = undefined;
        return false;
      }
      trustStore.set(cwd, true);
      this.autoTrustOnReloadCwd = undefined;
      return true;
    } catch (error) {
      this.showWarning(`Could not save project trust after reload: ${toErrorMessage(error)}`);
      return false;
    }
  }

  protected showUserMessageSelector(): void {
    const userMessages = this.session.context.transcript.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.showStatus("No messages to fork from");
      return;
    }

    const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

    this.editorSlot.showSelector((done) => {
      const selector = new UserMessageSelectorComponent(
        userMessages.map((m) => ({ id: m.entryId, text: m.text })),
        (entryId) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              try {
                const result = yield* awaited(this.runtimeHost.fork(entryId));
                if (result.cancelled) {
                  this.ui.requestRender();
                  return;
                }

                this.editor.setText(result.selectedText ?? "");
                this.showStatus("Forked to new session");
              } catch (error: unknown) {
                this.showError(toErrorMessage(error));
              }
            }, this),
          ),
        () => {
          done();
          this.ui.requestRender();
        },
        initialSelectedId,
      );
      return { component: selector, focus: selector.getMessageList() };
    });
  }
}
