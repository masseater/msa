import { sliceByColumn } from "./text-slice.ts";
import {
  type Component,
  compositeTuiLine,
  dispatchMouseEvent,
  type TuiMouseDispatchResult,
  type TuiMouseEvent,
} from "./tui-component.ts";
import type { OverlayBounds } from "./tui-interface.ts";
import { type OverlayOptions, resolveOverlayLayout } from "./tui-overlay-layout.ts";
import { visibleWidth } from "./utils.ts";

export type OverlayStackEntry = {
  component: Component;
  options?: OverlayOptions;
  preFocus: Component | null;
  hidden: boolean;
  focusOrder: number;
  bounds?: OverlayBounds | undefined;
};

type RenderedOverlayLayout = {
  entry: OverlayStackEntry;
  row: number;
  col: number;
  width: number;
  height: number;
};

type RenderedOverlay = RenderedOverlayLayout & { lines: string[] };

type OverlayBlockedFocusResume =
  | { status: "restore-overlay" }
  | { status: "focus-target"; target: Component | null };
type EligibleOverlayFocusRestoreState = { status: "eligible"; overlay: OverlayStackEntry };
export type BlockedOverlayFocusRestoreState = {
  status: "blocked";
  overlay: OverlayStackEntry;
  blockedBy: Component;
  resume: OverlayBlockedFocusResume;
};
type ActiveOverlayFocusRestoreState =
  | EligibleOverlayFocusRestoreState
  | BlockedOverlayFocusRestoreState;
export type OverlayFocusRestoreState = { status: "inactive" } | ActiveOverlayFocusRestoreState;

export interface OverlayViewport {
  readonly columns: number;
  readonly rows: number;
}

export interface OverlayFrame {
  termWidth: number;
  termHeight: number;
  resolveFakeCursors: (lines: string[]) => string[];
}

function containsPoint(layout: RenderedOverlayLayout, event: TuiMouseEvent): boolean {
  return (
    event.screenX >= layout.col &&
    event.screenX < layout.col + layout.width &&
    event.screenY >= layout.row &&
    event.screenY < layout.row + layout.height
  );
}

export class OverlayStack {
  entries: OverlayStackEntry[] = [];
  restore: OverlayFocusRestoreState = { status: "inactive" };
  private renderedLayouts: RenderedOverlayLayout[] = [];
  private focusOrderCounter = 0;
  private readonly viewport: () => OverlayViewport;

  constructor(viewport: () => OverlayViewport) {
    this.viewport = viewport;
  }

  nextFocusOrder(): number {
    return ++this.focusOrderCounter;
  }

  isVisible(entry: OverlayStackEntry): boolean {
    if (entry.hidden) return false;
    if (entry.options?.visible !== undefined) {
      const { columns, rows } = this.viewport();
      return entry.options.visible(columns, rows);
    }
    return true;
  }

  isLive(entry: OverlayStackEntry): boolean {
    return this.entries.includes(entry) && this.isVisible(entry);
  }

  hasComponent(component: Component | null): boolean {
    return component !== null && this.entries.some((entry) => entry.component === component);
  }

  findVisible(component: Component | null): OverlayStackEntry | undefined {
    if (component === null) return undefined;
    return this.entries.find((entry) => entry.component === component && this.isVisible(entry));
  }

  getTopmostVisible(): OverlayStackEntry | undefined {
    let topmost: OverlayStackEntry | undefined;
    for (const overlay of this.entries) {
      if (overlay.options?.nonCapturing === true || !this.isVisible(overlay)) continue;
      if (topmost === undefined || overlay.focusOrder > topmost.focusOrder) {
        topmost = overlay;
      }
    }
    return topmost;
  }

  clearRestore(): void {
    this.restore = { status: "inactive" };
  }

  clearRestoreFor(overlay: OverlayStackEntry): void {
    if (this.restore.status !== "inactive" && this.restore.overlay === overlay) {
      this.clearRestore();
    }
  }

  resolveBlockedResume(restoreState: BlockedOverlayFocusRestoreState): Component | null {
    if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
    this.clearRestore();
    return restoreState.resume.target;
  }

  getVisibleRestore(): OverlayFocusRestoreState {
    const restoreState = this.restore;
    if (restoreState.status === "inactive") return restoreState;
    if (!this.isLive(restoreState.overlay)) {
      return { status: "inactive" };
    }
    return restoreState;
  }

  isFocusAncestor(entry: OverlayStackEntry, component: Component): boolean {
    const visited = new Set<Component>();
    let current = entry.preFocus;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      if (current === component) return true;
      current = this.findPreFocus(current);
    }
    return false;
  }

  remove(entry: OverlayStackEntry): boolean {
    const index = this.entries.indexOf(entry);
    if (index === -1) return false;
    this.clearRestoreFor(entry);
    for (const overlay of this.entries) {
      if (overlay !== entry && overlay.preFocus === entry.component) {
        overlay.preFocus = entry.preFocus;
      }
    }
    this.entries.splice(index, 1);
    return true;
  }

  dispatchMouse(event: TuiMouseEvent): { hit: boolean; result?: TuiMouseDispatchResult } {
    const layout = this.renderedLayouts.findLast((candidate) => containsPoint(candidate, event));
    if (layout === undefined) return { hit: false };
    const result = dispatchMouseEvent(layout.entry.component, {
      ...event,
      x: event.screenX - layout.col,
      y: event.screenY - layout.row,
      width: layout.width,
      height: layout.height,
    });
    if (result === undefined) return { hit: true };
    return {
      hit: true,
      result: result.focus === true ? { ...result, focusTarget: layout.entry.component } : result,
    };
  }

  composite(lines: string[], frame: OverlayFrame): string[] {
    if (this.entries.length === 0) {
      this.renderedLayouts = [];
      return lines;
    }
    const result = [...lines];
    for (const entry of this.entries) entry.bounds = undefined;

    const rendered = this.renderVisible(frame);
    this.renderedLayouts = rendered.map(({ entry, row, col, width, height }) => ({
      entry,
      row,
      col,
      width,
      height,
    }));

    const minLinesNeeded = rendered.reduce(
      (needed, overlay) => Math.max(needed, overlay.row + overlay.height),
      result.length,
    );
    const workingHeight = Math.max(result.length, frame.termHeight, minLinesNeeded);
    while (result.length < workingHeight) {
      result.push("");
    }
    const viewportStart = Math.max(0, workingHeight - frame.termHeight);
    for (const overlay of rendered) {
      paintOverlay(result, overlay, viewportStart, frame.termWidth);
    }
    return result;
  }

  private renderVisible(frame: OverlayFrame): RenderedOverlay[] {
    const visibleEntries = this.entries.filter((entry) => this.isVisible(entry));
    visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
    return visibleEntries.map((entry) => {
      const { component, options } = entry;
      const { width, maxHeight } = resolveOverlayLayout(
        options,
        0,
        frame.termWidth,
        frame.termHeight,
      );
      let overlayLines = frame.resolveFakeCursors(component.render(width));
      if (maxHeight !== undefined && overlayLines.length > maxHeight) {
        overlayLines = overlayLines.slice(0, maxHeight);
      }
      const { row, col } = resolveOverlayLayout(
        options,
        overlayLines.length,
        frame.termWidth,
        frame.termHeight,
      );
      entry.bounds = { row, col, width, height: overlayLines.length };
      return { entry, lines: overlayLines, row, col, width, height: overlayLines.length };
    });
  }

  private findPreFocus(component: Component): Component | null {
    return this.entries.find((overlay) => overlay.component === component)?.preFocus ?? null;
  }
}

function paintOverlay(
  result: string[],
  overlay: RenderedOverlay,
  viewportStart: number,
  termWidth: number,
): void {
  for (const [i, overlayLine] of overlay.lines.entries()) {
    const idx = viewportStart + overlay.row + i;
    const baseLine = result[idx];
    if (baseLine === undefined) continue;
    const truncatedOverlayLine =
      visibleWidth(overlayLine) > overlay.width
        ? sliceByColumn(overlayLine, 0, overlay.width, true)
        : overlayLine;
    result[idx] = compositeTuiLine(
      baseLine,
      truncatedOverlayLine,
      overlay.col,
      overlay.width,
      termWidth,
    );
  }
}
