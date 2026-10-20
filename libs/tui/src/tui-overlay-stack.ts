import textSlice from "./text-slice.ts";
import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import tuiOverlayLayout from "./tui-overlay-layout.ts";
import type tuiOverlayStackTypes from "./tui-overlay-stack.types.ts";
import utils from "./utils.ts";

const { compositeTuiLine, dispatchMouseEvent } = tuiComponent;
const { resolveOverlayLayout } = tuiOverlayLayout;
const { visibleWidth } = utils;
const { sliceByColumn } = textSlice;

type RenderedOverlayLayout = {
  entry: tuiOverlayStackTypes.OverlayStackEntry;
  row: number;
  col: number;
  width: number;
  height: number;
};

type RenderedOverlay = RenderedOverlayLayout & { lines: string[] };

function containsPoint(
  layout: RenderedOverlayLayout,
  event: tuiComponentTypes.TuiMouseEvent,
): boolean {
  return (
    event.screenX >= layout.col &&
    event.screenX < layout.col + layout.width &&
    event.screenY >= layout.row &&
    event.screenY < layout.row + layout.height
  );
}

export default class OverlayStack {
  entries: tuiOverlayStackTypes.OverlayStackEntry[] = [];
  restore: tuiOverlayStackTypes.OverlayFocusRestoreState = { status: "inactive" };
  private renderedLayouts: RenderedOverlayLayout[] = [];
  private focusOrderCounter = 0;
  private readonly viewport: () => tuiOverlayStackTypes.OverlayViewport;

  constructor(viewport: () => tuiOverlayStackTypes.OverlayViewport) {
    this.viewport = viewport;
  }

  nextFocusOrder(): number {
    return ++this.focusOrderCounter;
  }

  isVisible(entry: tuiOverlayStackTypes.OverlayStackEntry): boolean {
    if (entry.hidden) return false;
    if (entry.options?.visible !== undefined) {
      const { columns, rows } = this.viewport();
      return entry.options.visible(columns, rows);
    }
    return true;
  }

  isLive(entry: tuiOverlayStackTypes.OverlayStackEntry): boolean {
    return this.entries.includes(entry) && this.isVisible(entry);
  }

  hasComponent(component: tuiComponentTypes.Component | null): boolean {
    return component !== null && this.entries.some((entry) => entry.component === component);
  }

  findVisible(
    component: tuiComponentTypes.Component | null,
  ): tuiOverlayStackTypes.OverlayStackEntry | undefined {
    if (component === null) return undefined;
    return this.entries.find((entry) => entry.component === component && this.isVisible(entry));
  }

  getTopmostVisible(): tuiOverlayStackTypes.OverlayStackEntry | undefined {
    let topmost: tuiOverlayStackTypes.OverlayStackEntry | undefined;
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

  clearRestoreFor(overlay: tuiOverlayStackTypes.OverlayStackEntry): void {
    if (this.restore.status !== "inactive" && this.restore.overlay === overlay) {
      this.clearRestore();
    }
  }

  resolveBlockedResume(
    restoreState: tuiOverlayStackTypes.BlockedOverlayFocusRestoreState,
  ): tuiComponentTypes.Component | null {
    if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
    this.clearRestore();
    return restoreState.resume.target;
  }

  getVisibleRestore(): tuiOverlayStackTypes.OverlayFocusRestoreState {
    const restoreState = this.restore;
    if (restoreState.status === "inactive") return restoreState;
    if (!this.isLive(restoreState.overlay)) {
      return { status: "inactive" };
    }
    return restoreState;
  }

  isFocusAncestor(
    entry: tuiOverlayStackTypes.OverlayStackEntry,
    component: tuiComponentTypes.Component,
  ): boolean {
    const visited = new Set<tuiComponentTypes.Component>();
    let current = entry.preFocus;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      if (current === component) return true;
      current = this.findPreFocus(current);
    }
    return false;
  }

  remove(entry: tuiOverlayStackTypes.OverlayStackEntry): boolean {
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

  dispatchMouse(event: tuiComponentTypes.TuiMouseEvent): {
    hit: boolean;
    result?: tuiComponentTypes.TuiMouseDispatchResult;
  } {
    const layout = this.renderedLayouts.findLast((candidate) => containsPoint(candidate, event));
    if (layout === undefined) return { hit: false };
    const result = dispatchMouseEvent(layout.entry.component, {
      ...event,
      height: layout.height,
      width: layout.width,
      x: event.screenX - layout.col,
      y: event.screenY - layout.row,
    });
    if (result === undefined) return { hit: true };
    return {
      hit: true,
      result: result.focus === true ? { ...result, focusTarget: layout.entry.component } : result,
    };
  }

  composite(lines: string[], frame: tuiOverlayStackTypes.OverlayFrame): string[] {
    if (this.entries.length === 0) {
      this.renderedLayouts = [];
      return lines;
    }
    const result = [...lines];
    for (const entry of this.entries) entry.bounds = undefined;

    const rendered = this.renderVisible(frame);
    this.renderedLayouts = rendered.map(({ entry, row, col, width, height }) => ({
      col,
      entry,
      height,
      row,
      width,
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

  private renderVisible(frame: tuiOverlayStackTypes.OverlayFrame): RenderedOverlay[] {
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
      entry.bounds = { col, height: overlayLines.length, row, width };
      return { col, entry, height: overlayLines.length, lines: overlayLines, row, width };
    });
  }

  private findPreFocus(component: tuiComponentTypes.Component): tuiComponentTypes.Component | null {
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
