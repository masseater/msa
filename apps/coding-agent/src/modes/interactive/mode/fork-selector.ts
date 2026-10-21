import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import errorsModule from "../../../utils/errors.ts";
import UserMessageSelectorComponent from "../components/user-message-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;

export default class ForkSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showUserMessageSelector(): void {
    const userMessages = this.mode.session.context.transcript.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.mode.display.status.showStatus("No messages to fork from");
      return;
    }

    const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

    this.mode.editorSlot.showSelector((done) => {
      const selector = new UserMessageSelectorComponent(
        userMessages.map((m) => ({ id: m.entryId, text: m.text })),
        (entryId) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              try {
                const result = yield* awaited(this.mode.runtimeHost.fork(entryId));
                if (result.cancelled) {
                  this.mode.ui.requestRender();
                  return;
                }

                this.mode.editor.setText(result.selectedText ?? "");
                this.mode.display.status.showStatus("Forked to new session");
              } catch (error: unknown) {
                this.mode.display.status.showError(toErrorMessage(error));
              }
            }, this),
          ),
        () => {
          done();
          this.mode.ui.requestRender();
        },
        initialSelectedId,
      );
      return { component: selector, focus: selector.getMessageList() };
    });
  }
}
