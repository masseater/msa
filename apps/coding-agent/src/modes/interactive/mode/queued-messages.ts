import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import errorsModule from "../../../utils/errors.ts";
import keybindingHints from "../components/keybinding-hints.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer, TruncatedText } = tuiModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { keyDisplayText } = keybindingHints;

export default class QueuedMessages {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  compactionQueuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[] = [];

  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      followUp: [
        ...this.mode.session.run.queue.getFollowUpMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "followUp")
          .map((msg) => msg.text),
      ],
      steering: [
        ...this.mode.session.run.queue.getSteeringMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => msg.text),
      ],
    };
  }

  private clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.mode.session.run.queue.clearQueue();
    const compactionSteering = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.compactionQueuedMessages = [];
    return {
      followUp: [...followUp, ...compactionFollowUp],
      steering: [...steering, ...compactionSteering],
    };
  }

  isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.mode.session.extensions.binding.extensionRunner;

    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return extensionRunner.getCommand(commandName) !== undefined;
  }

  private startFirstQueuedPrompt(
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: interactiveModeInternalTypes.CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{
    rest: interactiveModeInternalTypes.CompactionQueuedMessage[];
    promptPromise: Promise<void>;
  }> {
    return awaitingWith(function* () {
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        yield* awaited(this.mode.session.run.prompting.prompt(message.text));
      }

      const promptPromise = this.mode.session.run.prompting
        .prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode })
        .catch((error) => {
          restoreQueue(error);
        });
      return { promptPromise, rest };
    }, this);
  }

  handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.mode.display.status.showStatus("No queued messages to restore");
    } else {
      this.mode.display.status.showStatus(
        `Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
      );
    }
  }

  updatePendingMessagesDisplay(): void {
    this.mode.layout.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.mode.layout.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.mode.layout.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.mode.layout.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = keyDisplayText("app.message.dequeue");
      const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
      this.mode.layout.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort === true) {
        void this.mode.session.run.lifecycle.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.mode.editor.getText();
    const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
    this.mode.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort === true) {
      void this.mode.session.run.lifecycle.abort();
    }
    return allQueued.length;
  }

  queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
    this.compactionQueuedMessages.push({ mode, text });
    this.mode.editor.addToHistory?.(text);
    this.mode.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.mode.display.status.showStatus("Queued message for after compaction");
  }

  flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.compactionQueuedMessages.length === 0) {
          return;
        }

        const { queuedMessages, restoreQueue } = this.takeCompactionQueue();

        const flushCompactionQueuePart12Result = yield* performed(
          this.deliverCompactionQueue(options, queuedMessages, restoreQueue),
        );
        if (flushCompactionQueuePart12Result.done) return flushCompactionQueuePart12Result.value;
      }, this),
    );
  }

  private deliverCompactionQueue(
    options: { willRetry?: boolean } | undefined,
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{ done: true; value: void } | { done: false; value: void }> {
    return awaitingWith(function* () {
      try {
        if (options?.willRetry === true) {
          for (const message of queuedMessages) {
            if (this.isExtensionCommand(message.text)) {
              yield* awaited(this.mode.session.run.prompting.prompt(message.text));
            } else if (message.mode === "followUp") {
              yield* awaited(this.mode.session.run.queue.followUp(message.text));
            } else {
              yield* awaited(this.mode.session.run.queue.steer(message.text));
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
            yield* awaited(this.mode.session.run.prompting.prompt(message.text));
          }
          return { done: true, value: undefined };
        }

        yield* performed(
          this.deliverFromFirstPrompt(queuedMessages, firstPromptIndex, firstPrompt, restoreQueue),
        );
      } catch (error) {
        restoreQueue(error);
      }
      return { done: false, value: undefined };
    }, this);
  }

  private deliverFromFirstPrompt(
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: interactiveModeInternalTypes.CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { rest, promptPromise } = yield* performed(
        this.startFirstQueuedPrompt(queuedMessages, firstPromptIndex, firstPrompt, restoreQueue),
      );

      yield* performed(this.deliverQueuedMessages(rest, promptPromise));
    }, this);
  }

  private takeCompactionQueue(): {
    queuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[];
    restoreQueue: (error: unknown) => void;
  } {
    const queuedMessages = [...this.compactionQueuedMessages];
    this.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.mode.session.run.queue.clearQueue();
      this.compactionQueuedMessages = queuedMessages;
      this.updatePendingMessagesDisplay();
      this.mode.display.status.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${toErrorMessage(
          error,
        )}`,
      );
    };
    return { queuedMessages, restoreQueue };
  }

  private deliverQueuedMessages(
    rest: interactiveModeInternalTypes.CompactionQueuedMessage[],
    promptPromise: Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      for (const message of rest) {
        if (this.isExtensionCommand(message.text)) {
          yield* awaited(this.mode.session.run.prompting.prompt(message.text));
        } else if (message.mode === "followUp") {
          yield* awaited(this.mode.session.run.queue.followUp(message.text));
        } else {
          yield* awaited(this.mode.session.run.queue.steer(message.text));
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    }, this);
  }
}
