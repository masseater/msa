import type altScreenEndIndicatorTypes from "./alt-screen-end-indicator.types.ts";
import altScreenMouseProtocol from "./alt-screen-mouse-protocol.ts";
import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import layoutModule from "./layout.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textTruncate from "./text-truncate.ts";
import tuiComponent from "./tui-component.ts";
import utils from "./utils.ts";

const { isPlainPress } = altScreenMouseProtocol;
const { getScrollViewBox, getScrollbarGeometry } = layoutModule;
const { isImageLine } = terminalImageKitty;
const { truncateToWidth } = textTruncate;
const { visibleWidth } = utils;
const { compositeTuiLine } = tuiComponent;

interface IndicatorRect {
  row: number;
  column: number;
  width: number;
}

export default class ScrollToEndIndicator {
  private readonly label: (() => string) | undefined;
  private rect: IndicatorRect | undefined;

  constructor(label: (() => string) | undefined) {
    this.label = label;
  }

  hit(event: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
    const rect = this.rect;
    if (rect === undefined || !isPlainPress(event)) return false;
    return event.y === rect.row && event.x >= rect.column && event.x < rect.column + rect.width;
  }

  composite(
    screen: string[],
    { layout, scrollView, width }: altScreenEndIndicatorTypes.IndicatorFrame,
  ): string[] {
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
    this.rect = { column, row, width: textWidth };
    return result;
  }
}
