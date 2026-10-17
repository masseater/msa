import { Clock, Effect } from "effect";

import type { SgrMouseEvent } from "./alt-screen-mouse-protocol.ts";
import { SelectionAutoScroll } from "./alt-screen-selection-autoscroll.ts";
import { selectionPointAt, selectionSourceLine } from "./alt-screen-selection-points.ts";
import {
  lineSelection,
  orderedSelection,
  paintSelection,
  type SelectionPoint,
  type SelectionRange,
  selectedText,
  wordSelection,
} from "./alt-screen-selection-text.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { getScrollViewBox, getScrollViewsAt, type LayoutFrame } from "./layout.ts";
import { getOsc8LinkAtColumn } from "./text-slice.ts";

const DOUBLE_CLICK_INTERVAL_MS = 500;

type SelectionGranularity = "character" | "word" | "line";

interface ClickTarget {
  timestamp: number;
  count: number;
  row: number;
  scrollView?: ScrollView | undefined;
  wordStart: number;
  wordEnd: number;
}

export interface SelectionHost {
  readonly view: AltScreenView;
  openUrl: ((url: string) => void) | undefined;
  copyOnSelect(): boolean;
  copySelection(): void;
  dispatchClick(event: SgrMouseEvent, clickCount: number): boolean | undefined;
}

export class AltScreenSelection {
  private readonly host: SelectionHost;
  private readonly autoScroll: SelectionAutoScroll;
  private anchor: SelectionPoint | undefined;
  private focus: SelectionPoint | undefined;
  private granularity: SelectionGranularity = "character";
  private initialRange: SelectionRange | undefined;
  private lastClick: ClickTarget | undefined;
  private pressActive = false;
  private dragged = false;
  private pressedUrl: string | undefined;

  constructor(host: SelectionHost) {
    this.host = host;
    this.autoScroll = new SelectionAutoScroll({
      view: host.view,
      anchorScrollView: () => this.anchor?.scrollView,
      onScroll: (point) => {
        if (point !== undefined) this.updateFocus(point);
        host.view.requestRender();
      },
    });
  }

  clear(): void {
    this.stopPress();
    this.anchor = undefined;
    this.focus = undefined;
    this.granularity = "character";
    this.initialRange = undefined;
    this.pressedUrl = undefined;
    this.dragged = false;
  }

  reset(): void {
    this.clear();
    this.lastClick = undefined;
  }

  stopPress(): void {
    this.autoScroll.stop();
    this.pressActive = false;
  }

  focusOut(): void {
    const hadActiveSelection = this.pressActive;
    const hadNonEmptyActiveSelection = hadActiveSelection && this.bounds() !== undefined;
    this.stopPress();
    this.pressedUrl = undefined;
    this.dragged = false;
    if (hadActiveSelection) {
      this.anchor = undefined;
      this.focus = undefined;
      this.granularity = "character";
      this.initialRange = undefined;
      if (hadNonEmptyActiveSelection) this.host.view.requestRender();
    }
    this.lastClick = undefined;
  }

  bounds(): SelectionRange | undefined {
    if (this.anchor === undefined || this.focus === undefined) return undefined;
    return orderedSelection(this.anchor, this.focus);
  }

  activeText(): string | undefined {
    const selection = this.bounds();
    if (selection === undefined) return undefined;
    let sourceLines: readonly string[] = this.host.view.frame.previousScreen;
    if (selection.start.scrollView !== undefined) {
      const layout = this.host.view.frame.currentLayout;
      if (layout === undefined) return undefined;
      const box = getScrollViewBox(layout, selection.start.scrollView);
      if (box?.scrollContentLines === undefined) return undefined;
      sourceLines = box.scrollContentLines;
    }
    return selectedText(sourceLines, selection);
  }

  apply(screen: string[], layout: LayoutFrame | undefined): string[] {
    const selection = this.bounds();
    if (selection === undefined) return screen;
    const scrollView = selection.start.scrollView;
    const columns = this.host.view.columns();
    if (scrollView === undefined) {
      return paintSelection(screen, {
        selection,
        minRow: 0,
        maxRow: screen.length - 1,
        minColumn: 0,
        maxColumn: columns,
      });
    }
    const box = layout === undefined ? undefined : getScrollViewBox(layout, scrollView);
    if (box === undefined) return screen;
    const toScreen = (point: SelectionPoint): SelectionPoint => ({
      ...point,
      row: box.rect.y + point.row - scrollView.scrollTop,
      col: box.rect.x + point.col,
    });
    return paintSelection(screen, {
      selection: { start: toScreen(selection.start), end: toScreen(selection.end) },
      minRow: Math.max(0, box.rect.y, box.clip.y),
      maxRow: Math.min(
        screen.length - 1,
        box.rect.y + box.rect.height - 1,
        box.clip.y + box.clip.height - 1,
      ),
      minColumn: Math.max(0, box.rect.x, box.clip.x),
      maxColumn: Math.min(columns, box.rect.x + box.rect.width, box.clip.x + box.clip.width),
    });
  }

  handleMouse(event: SgrMouseEvent): void {
    const button = event.button & 3;
    if (button !== 0 && !(event.release && button === 3)) return;
    if (event.release) {
      this.handleRelease(event);
    } else if ((event.button & 32) === 0) {
      this.handlePress(event);
    } else {
      this.handleDrag(event);
    }
  }

  private pointAt(event: SgrMouseEvent, scrollView: ScrollView | undefined): SelectionPoint {
    return selectionPointAt(this.host.view, { x: event.x, y: event.y, scrollView });
  }

  private handleRelease(event: SgrMouseEvent): void {
    if (!this.pressActive) return;
    this.stopPress();
    const anchor = this.anchor;
    if (anchor === undefined) return;
    const point = this.pointAt(event, anchor.scrollView);
    this.updateFocus(point);
    const isClick =
      !this.dragged &&
      anchor.scrollView === point.scrollView &&
      anchor.row === point.row &&
      anchor.col === point.col;
    const clickedUrl = isClick ? this.pressedUrl : undefined;
    this.pressedUrl = undefined;
    const { openUrl } = this.host;
    if (clickedUrl !== undefined && clickedUrl !== "" && openUrl !== undefined) {
      this.anchor = undefined;
      this.focus = undefined;
      try {
        openUrl(clickedUrl);
      } catch {}
      this.host.view.requestRender();
      return;
    }
    if (isClick) {
      const render = this.host.dispatchClick(event, this.lastClick?.count ?? 1);
      if (render !== undefined) {
        this.clear();
        if (render) this.host.view.requestRender();
        return;
      }
    }
    if (this.host.copyOnSelect()) this.host.copySelection();
    this.host.view.requestRender();
  }

  private handleDrag(event: SgrMouseEvent): void {
    if (!this.pressActive || this.anchor === undefined) return;
    const point = this.pointAt(event, this.anchor.scrollView);
    this.dragged = true;
    this.lastClick = undefined;
    this.pressedUrl = undefined;
    this.updateFocus(point);
    this.autoScroll.update(event);
    this.host.view.requestRender();
  }

  private handlePress(event: SgrMouseEvent): void {
    this.autoScroll.stop();
    this.pressActive = true;
    const { view } = this.host;
    const layout = view.frame.currentLayout;
    const scrollView =
      !view.hasOverlay() && layout !== undefined
        ? getScrollViewsAt(layout, event.x, event.y)[0]
        : undefined;
    const anchor = this.pointAt(event, scrollView);
    const line = selectionSourceLine(view, anchor);
    const word = wordSelection(line, anchor);
    const clickCount = this.clickCount(anchor, word);
    const range =
      clickCount === 2 ? word : clickCount === 3 ? lineSelection(line, anchor) : undefined;
    this.granularity = range === undefined ? "character" : clickCount === 2 ? "word" : "line";
    this.initialRange = range;
    this.anchor = range?.start ?? anchor;
    this.focus = range?.end ?? anchor;
    this.dragged = false;
    this.pressedUrl =
      range === undefined
        ? getOsc8LinkAtColumn(
            view.frame.previousScreen[Math.max(0, Math.min(view.rows() - 1, event.y))] ?? "",
            Math.max(0, Math.min(view.columns() - 1, event.x)),
          )
        : undefined;
    view.requestRender();
  }

  private updateFocus(point: SelectionPoint): void {
    const initial = this.initialRange;
    if (this.granularity === "character" || initial === undefined) {
      this.focus = point;
      return;
    }
    const line = selectionSourceLine(this.host.view, point);
    const range =
      this.granularity === "word" ? wordSelection(line, point) : lineSelection(line, point);
    if (range === undefined) return;
    const targetBeforeInitial =
      range.start.row < initial.start.row ||
      (range.start.row === initial.start.row && range.start.col < initial.start.col);
    this.anchor = targetBeforeInitial ? initial.end : initial.start;
    this.focus = targetBeforeInitial ? range.start : range.end;
  }

  private clickCount(point: SelectionPoint, word: SelectionRange | undefined): number {
    const now = Effect.runSync(Clock.currentTimeMillis);
    const previous = this.lastClick;
    const count =
      word !== undefined &&
      previous !== undefined &&
      now - previous.timestamp <= DOUBLE_CLICK_INTERVAL_MS &&
      previous.row === point.row &&
      previous.scrollView === point.scrollView &&
      previous.wordStart === word.start.col &&
      previous.wordEnd === word.end.col
        ? (previous.count % 3) + 1
        : 1;
    this.lastClick =
      word === undefined
        ? undefined
        : {
            timestamp: now,
            count,
            row: point.row,
            scrollView: point.scrollView,
            wordStart: word.start.col,
            wordEnd: word.end.col,
          };
    return count;
  }
}
