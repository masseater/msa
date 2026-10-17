import { isPlainPress, type SgrMouseEvent } from "./alt-screen-mouse-protocol.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { getScrollbarGeometry, getScrollViewBox, type LayoutFrame } from "./layout.ts";
import { isImageLine } from "./terminal-image-kitty.ts";
import { truncateToWidth } from "./text-truncate.ts";
import { compositeTuiLine } from "./tui-component.ts";
import { visibleWidth } from "./utils.ts";

interface IndicatorRect {
  row: number;
  column: number;
  width: number;
}

export interface IndicatorFrame {
  layout: LayoutFrame;
  scrollView: ScrollView;
  width: number;
}

export class ScrollToEndIndicator {
  private readonly label: (() => string) | undefined;
  private rect: IndicatorRect | undefined;

  constructor(label: (() => string) | undefined) {
    this.label = label;
  }

  hit(event: SgrMouseEvent): boolean {
    const rect = this.rect;
    if (rect === undefined || !isPlainPress(event)) return false;
    return event.y === rect.row && event.x >= rect.column && event.x < rect.column + rect.width;
  }

  composite(screen: string[], { layout, scrollView, width }: IndicatorFrame): string[] {
    this.rect = undefined;
    if (this.label === undefined || !scrollView.followEnd || scrollView.isFollowingEnd)
      return screen;
    const box = getScrollViewBox(layout, scrollView);
    const clip = box?.clip;
    if (clip === undefined || clip.width <= 0 || clip.height <= 0) return screen;
    const row = clip.y + clip.height - 1;
    if (row >= screen.length || isImageLine(screen[row] ?? "")) return screen;
    const scrollbarColumn = box === undefined ? undefined : getScrollbarGeometry(box)?.column;
    const label = truncateToWidth(this.label(), clip.width, "");
    const column = clip.x + Math.floor((clip.width - visibleWidth(label)) / 2);
    const rightEdge = scrollbarColumn ?? clip.x + clip.width;
    const text = truncateToWidth(label, Math.max(0, rightEdge - column), "");
    const textWidth = visibleWidth(text);
    if (textWidth === 0) return screen;
    const result = [...screen];
    result[row] = compositeTuiLine(result[row] ?? "", text, column, textWidth, width);
    this.rect = { row, column, width: textWidth };
    return result;
  }
}
