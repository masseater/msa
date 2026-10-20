import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type customEditorTypes from "./components/custom-editor.types.ts";
import PaneResizer from "./components/pane-resizer.ts";
import ThreadPane from "./components/thread-pane.ts";
import orchestratorPaneSupport from "./orchestrator-pane-support.ts";
import type orchestratorPaneTypes from "./orchestrator-pane.types.ts";
import PaneWidth from "./pane-width.ts";

const { SplitPane } = tui;
const { ORCHESTRATOR_PANE } = orchestratorPaneSupport;

export default class OrchestratorPane {
  readonly width = new PaneWidth();
  private readonly options: orchestratorPaneTypes.OrchestratorPaneOptions;
  private threadsOpen = false;

  constructor(options: orchestratorPaneTypes.OrchestratorPaneOptions) {
    this.options = options;
  }

  layout(left: tuiTypes.Component): tuiTypes.SplitPane {
    const { orchestrator, state, rows, columns, requestRender } = this.options;
    return new SplitPane({
      divider: new PaneResizer({
        height: rows,
        onDrag: (screenX) => {
          if (this.width.dragTo(screenX, columns())) requestRender();
        },
      }),
      left,
      minLeftWidth: ORCHESTRATOR_PANE.minLeftWidth,
      minRightWidth: ORCHESTRATOR_PANE.minRightWidth,
      right: new ThreadPane({ height: rows, orchestrator, state }),
      rightShare: () => this.width.share,
      visible: () => !this.threadsOpen && orchestrator() !== undefined,
    });
  }

  bindKeys(editor: customEditorTypes.CustomEditor, openThreads: () => void): void {
    const active = () => this.options.orchestrator() !== undefined;
    const resize = (columns: number) => {
      if (active() && this.width.nudge(columns, this.options.columns())) {
        this.options.requestRender();
      }
    };
    editor.onAction("app.orchestrator.threads", () => {
      if (active()) openThreads();
    });
    editor.onAction("app.orchestrator.paneWiden", () => resize(ORCHESTRATOR_PANE.stepColumns));
    editor.onAction("app.orchestrator.paneNarrow", () => resize(-ORCHESTRATOR_PANE.stepColumns));
  }

  openThreads(): () => void {
    this.threadsOpen = true;
    this.options.requestRender();
    return () => {
      this.threadsOpen = false;
      this.options.requestRender();
    };
  }
}
