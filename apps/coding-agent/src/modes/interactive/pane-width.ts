import tui from "@msa/tui";

import orchestratorPaneSupport from "./orchestrator-pane-support.ts";

const { splitPaneWidths } = tui;
const { ORCHESTRATOR_PANE } = orchestratorPaneSupport;

export default class PaneWidth {
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
