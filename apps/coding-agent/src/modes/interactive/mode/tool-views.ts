import errorsModule from "../../../utils/errors.ts";
import interval from "../../interval.ts";
import MemoryView from "../components/memory-view.ts";
import ModelSelectorComponent from "../components/model-selector.ts";
import tasksViewHelpers from "../components/tasks-view-helpers.ts";
import TasksView from "../components/tasks-view.ts";
import type InteractiveMode from "../interactive-mode.ts";
import OrchestratorPane from "../orchestrator-pane.ts";

const { viewHelpers } = tasksViewHelpers;
const { every } = interval;
const { toErrorMessage } = errorsModule;

export default class ToolViews {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private readonly tasksViewState = viewHelpers.createTasksViewState();

  readonly orchestratorPane = new OrchestratorPane({
    columns: () => this.mode.ui.terminal.columns,
    orchestrator: () => this.mode.session.integrations.orchestration.orchestrator,
    requestRender: () => this.mode.ui.requestRender(),
    rows: () => Math.max(1, this.mode.ui.terminal.rows),
    state: this.tasksViewState,
  });

  showMemoryView(): void {
    const memory = this.mode.session.integrations.memory.memory;
    if (memory === undefined) {
      this.mode.display.status.showStatus("Memory is disabled (settings: memory.enabled)");
      return;
    }
    this.mode.editorSlot.showSelector((done) => {
      const view = new MemoryView({
        confirm: (message) =>
          this.mode.extensions.dialogs.extensionDialogs.confirm("Forget memory", message),
        maxHeight: () => this.mode.ui.terminal.rows - 4,
        onClose: () => {
          done();
          this.mode.ui.requestRender();
        },
        onError: (message) => this.mode.display.status.showError(message),
        requestRender: () => this.mode.ui.requestRender(),
        service: memory,
      });
      return { component: view, focus: view };
    });
  }

  showTasksView(initialId?: string): void {
    const orchestrator = this.mode.session.integrations.orchestration.orchestrator;
    if (orchestrator === undefined) {
      this.mode.display.status.showStatus("The orchestrator is unavailable in this session");
      return;
    }
    void orchestrator.refresh();
    this.mode.editorSlot.showSelector((done) => {
      const tick = every(() => this.mode.ui.requestRender(), 1000);
      const closePane = this.orchestratorPane.openThreads();
      const view = new TasksView(
        {
          maxHeight: () => this.mode.ui.terminal.rows - 4,
          onClose: () => {
            done();
            this.mode.ui.requestRender();
          },
          onError: (message) => this.mode.display.status.showError(message),
          onPickModel: (id) => this.showTaskModelSelector(id),
          orchestrator,
          requestRender: () => this.mode.ui.requestRender(),
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

  private showTaskModelSelector(id: string): void {
    const orchestrator = this.mode.session.integrations.orchestration.orchestrator;
    if (orchestrator === undefined) return;
    this.mode.editorSlot.showSelector((done) => {
      const back = () => {
        done();
        this.showTasksView(id);
      };
      const selector = new ModelSelectorComponent(
        this.mode.ui,
        undefined,
        this.mode.session.models.selection.modelRuntime,
        this.mode.session.models.selection.scopedModels,
        (model) => {
          orchestrator
            .setModel(id, `${model.provider}/${model.id}`)
            .then(back, (error: unknown) => {
              back();
              this.mode.display.status.showError(toErrorMessage(error));
            });
        },
        back,
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }
}
