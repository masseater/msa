import { Clock, Effect } from "effect";

import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type altScreenSelectionAutoscrollTypes from "./alt-screen-selection-autoscroll.types.ts";
import altScreenSelectionKit from "./alt-screen-selection-kit.ts";
import type altScreenSelectionTextTypes from "./alt-screen-selection-text.types.ts";
import type altScreenSelectionTypes from "./alt-screen-selection.types.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import layoutModule from "./layout.ts";
import type layoutTypes from "./layout.types.ts";
import textSlice from "./text-slice.ts";

const { SelectionAutoScroll, altScreenSelectionPoints, altScreenSelectionText } =
  altScreenSelectionKit;

const { lineSelection, orderedSelection, paintSelection, selectedText, wordSelection } =
  altScreenSelectionText;
const { getScrollViewBox, getScrollViewsAt } = layoutModule;
const { selectionPointAt, selectionSourceLine } = altScreenSelectionPoints;
const { getOsc8LinkAtColumn } = textSlice;

const DOUBLE_CLICK_INTERVAL_MS = 500;

type SelectionGranularity = "character" | "word" | "line";

interface ClickTarget {
  timestamp: number;
  count: number;
  row: number;
  scrollView?: scrollViewTypes.ScrollView | undefined;
  wordStart: number;
  wordEnd: number;
}

export default class AltScreenSelection {
  private readonly host: altScreenSelectionTypes.SelectionHost;
  private readonly autoScroll: altScreenSelectionAutoscrollTypes.SelectionAutoScroll;
  private anchor: altScreenSelectionTextTypes.SelectionPoint | undefined;
  private focus: altScreenSelectionTextTypes.SelectionPoint | undefined;
  private granularity: SelectionGranularity = "character";
  private initialRange: altScreenSelectionTextTypes.SelectionRange | undefined;
  private lastClick: ClickTarget | undefined;
  private pressActive = false;
  private dragged = false;
  private pressedUrl: string | undefined;

  constructor(host: altScreenSelectionTypes.SelectionHost) {
    this.host = host;
    this.autoScroll = new SelectionAutoScroll({
      anchorScrollView: () => this.anchor?.scrollView,
      onScroll: (point) => {
        if (point !== undefined) this.updateFocus(point);
        host.view.requestRender();
      },
      view: host.view,
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

  bounds(): altScreenSelectionTextTypes.SelectionRange | undefined {
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

  apply(screen: string[], layout: layoutTypes.LayoutFrame | undefined): string[] {
    const selection = this.bounds();
    if (selection === undefined) return screen;
    const scrollView = selection.start.scrollView;
    const columns = this.host.view.columns();
    if (scrollView === undefined) {
      return paintSelection(screen, {
        maxColumn: columns,
        maxRow: screen.length - 1,
        minColumn: 0,
        minRow: 0,
        selection,
      });
    }
    const box = layout === undefined ? undefined : getScrollViewBox(layout, scrollView);
    if (box === undefined) return screen;
    const toScreen = (
      point: altScreenSelectionTextTypes.SelectionPoint,
    ): altScreenSelectionTextTypes.SelectionPoint => ({
      ...point,
      col: box.rect.x + point.col,
      row: box.rect.y + point.row - scrollView.scrollTop,
    });
    return paintSelection(screen, {
      maxColumn: Math.min(columns, box.rect.x + box.rect.width, box.clip.x + box.clip.width),
      maxRow: Math.min(
        screen.length - 1,
        box.rect.y + box.rect.height - 1,
        box.clip.y + box.clip.height - 1,
      ),
      minColumn: Math.max(0, box.rect.x, box.clip.x),
      minRow: Math.max(0, box.rect.y, box.clip.y),
      selection: { end: toScreen(selection.end), start: toScreen(selection.start) },
    });
  }

  handleMouse(event: altScreenMouseProtocolTypes.SgrMouseEvent): void {
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

  private pointAt(
    event: altScreenMouseProtocolTypes.SgrMouseEvent,
    scrollView: scrollViewTypes.ScrollView | undefined,
  ): altScreenSelectionTextTypes.SelectionPoint {
    return selectionPointAt(this.host.view, { scrollView, x: event.x, y: event.y });
  }

  private handleRelease(event: altScreenMouseProtocolTypes.SgrMouseEvent): void {
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

  private handleDrag(event: altScreenMouseProtocolTypes.SgrMouseEvent): void {
    if (!this.pressActive || this.anchor === undefined) return;
    const point = this.pointAt(event, this.anchor.scrollView);
    this.dragged = true;
    this.lastClick = undefined;
    this.pressedUrl = undefined;
    this.updateFocus(point);
    this.autoScroll.update(event);
    this.host.view.requestRender();
  }

  private handlePress(event: altScreenMouseProtocolTypes.SgrMouseEvent): void {
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

  private updateFocus(point: altScreenSelectionTextTypes.SelectionPoint): void {
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

  private clickCount(
    point: altScreenSelectionTextTypes.SelectionPoint,
    word: altScreenSelectionTextTypes.SelectionRange | undefined,
  ): number {
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
            count,
            row: point.row,
            scrollView: point.scrollView,
            timestamp: now,
            wordEnd: word.end.col,
            wordStart: word.start.col,
          };
    return count;
  }
}
