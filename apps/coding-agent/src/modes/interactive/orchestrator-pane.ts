import { type Component, SplitPane, splitPaneWidths } from "@msa/tui";

import type { Orchestrator } from "../../core/orchestrator/orchestrator.ts";
import type { CustomEditor } from "./components/custom-editor.ts";
import { PaneResizer } from "./components/pane-resizer.ts";
import type { TasksViewState } from "./components/tasks-view-helpers.ts";
import { ThreadPane } from "./components/thread-pane.ts";

export const ORCHESTRATOR_PANE = {
  share: 0.3,
  minRightWidth: 24,
  minLeftWidth: 40,
  stepColumns: 2,
} as const;

export class PaneWidth {
  private current: number = ORCHESTRATOR_PANE.share;

  get share(): number {
    return this.current;
  }

  dragTo(screenX: number, totalWidth: number): boolean {
    return this.setRightWidth(Math.floor(totalWidth) - 1 - screenX, totalWidth);
  }

  nudge(columns: number, totalWidth: number): boolean {
    const right = splitPaneWidths(totalWidth, this.current).right;
    const collapsed = right < ORCHESTRATOR_PANE.minRightWidth;
    const target = collapsed && columns > 0 ? ORCHESTRATOR_PANE.minRightWidth : right + columns;
    return this.setRightWidth(target, totalWidth);
  }

  private setRightWidth(width: number, totalWidth: number): boolean {
    const content = Math.floor(totalWidth) - 1;
    if (content < 1) return false;
    const rounded = Math.round(width);
    const maximum = Math.max(0, content - ORCHESTRATOR_PANE.minLeftWidth);
    const next =
      rounded < ORCHESTRATOR_PANE.minRightWidth ? 0 : Math.min(maximum, rounded) / content;
    if (next === this.current) return false;
    this.current = next;
    return true;
  }
}

export interface OrchestratorPaneOptions {
  orchestrator: () => Orchestrator | undefined;
  state: TasksViewState;
  columns: () => number;
  rows: () => number;
  requestRender: () => void;
}

export class OrchestratorPane {
  readonly width = new PaneWidth();
  private readonly options: OrchestratorPaneOptions;
  private threadsOpen = false;

  constructor(options: OrchestratorPaneOptions) {
    this.options = options;
  }

  layout(left: Component): SplitPane {
    const { orchestrator, state, rows, columns, requestRender } = this.options;
    return new SplitPane({
      left,
      right: new ThreadPane({ orchestrator, state, height: rows }),
      divider: new PaneResizer({
        height: rows,
        onDrag: (screenX) => {
          if (this.width.dragTo(screenX, columns())) requestRender();
        },
      }),
      rightShare: () => this.width.share,
      minRightWidth: ORCHESTRATOR_PANE.minRightWidth,
      minLeftWidth: ORCHESTRATOR_PANE.minLeftWidth,
      visible: () => !this.threadsOpen && orchestrator() !== undefined,
    });
  }

  bindKeys(editor: CustomEditor, openThreads: () => void): void {
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
