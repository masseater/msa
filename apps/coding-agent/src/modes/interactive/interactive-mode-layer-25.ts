import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import clipboard from "../../utils/clipboard.ts";
import errorsModule from "../../utils/errors.ts";
import interval from "../interval.ts";
import ModelSelectorComponent from "./components/model-selector.ts";
import TasksView from "./components/tasks-view.ts";
import InteractiveModeLayer24 from "./interactive-mode-layer-24.ts";

const { every } = interval;
const { toErrorMessage } = errorsModule;
const { awaited, awaitingWith } = awaitingModule;
const { TuiAltScreen } = tuiModule;
const { copyToClipboard } = clipboard;

export default abstract class InteractiveModeLayer25 extends InteractiveModeLayer24 {
  protected showTasksView(initialId?: string): void {
    const orchestrator = this.session.orchestrator;
    if (orchestrator === undefined) {
      this.showStatus("The orchestrator is unavailable in this session");
      return;
    }
    void orchestrator.refresh();
    this.editorSlot.showSelector((done) => {
      const tick = every(() => this.ui.requestRender(), 1000);
      const closePane = this.orchestratorPane.openThreads();
      const view = new TasksView(
        {
          maxHeight: () => this.ui.terminal.rows - 4,
          onClose: () => {
            done();
            this.ui.requestRender();
          },
          onError: (message) => this.showError(message),
          onPickModel: (id) => this.showTaskModelSelector(id),
          orchestrator,
          requestRender: () => this.ui.requestRender(),
          state: this.tasksViewState,
        },
        initialId,
      );
      return {
        component: view,
        dispose: () => {
          tick.cancel();
          closePane();
        },
        focus: view,
      };
    });
  }

  protected showTaskModelSelector(id: string): void {
    const orchestrator = this.session.orchestrator;
    if (orchestrator === undefined) return;
    this.editorSlot.showSelector((done) => {
      const back = () => {
        done();
        this.showTasksView(id);
      };
      const selector = new ModelSelectorComponent(
        this.ui,
        undefined,
        this.session.modelRuntime,
        this.session.scopedModels,
        (model) => {
          orchestrator
            .setModel(id, `${model.provider}/${model.id}`)
            .then(back, (error: unknown) => {
              back();
              this.showError(toErrorMessage(error));
            });
        },
        back,
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }

  protected handleCopyCommand(
    options: { flashConfirmation?: boolean; preferSelection?: boolean } = {},
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (
          options.preferSelection === true &&
          this.ui instanceof TuiAltScreen &&
          !this.ui.getCopyOnSelect() &&
          this.ui.hasActiveSelection()
        ) {
          yield* awaited(this.ui.copyActiveSelectionToClipboard());
          return;
        }

        const text = this.session.getLastAssistantText();
        if (text === undefined || text === "") {
          this.showError("No agent messages to copy yet.");
          return;
        }

        try {
          yield* awaited(copyToClipboard(text));
          if (options.flashConfirmation === true && this.ui instanceof TuiAltScreen) {
            this.ui.flash("Copied!");
          } else {
            this.showStatus("Copied last agent message to clipboard");
          }
        } catch (error) {
          this.showError(toErrorMessage(error));
        }
      }, this),
    );
  }
}
