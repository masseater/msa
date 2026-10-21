import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";
import type scrollWindowTypes from "./scroll-window.types.ts";

const { theme } = themeModule;

const { visibleWidth } = tui;

function lineWindow(
  lines: number,
  height: number,
  offset: number,
  cursorLine?: number,
  cursorEnd = cursorLine,
): Omit<scrollWindowTypes.FittedView, "lines"> {
  const maxOffset = Math.max(0, lines - height);
  let start = offset;
  if (cursorLine !== undefined && cursorEnd !== undefined) {
    if (cursorLine < start) start = cursorLine;
    else if (cursorEnd >= start + height) start = cursorEnd - height + 1;
  }
  start = Math.max(0, Math.min(start, maxOffset));
  return { above: start, below: Math.max(0, lines - start - height), offset: start };
}

function fitView(
  frame: scrollWindowTypes.ViewFrame,
  width: number,
  max: number,
  offset: number,
): scrollWindowTypes.FittedView {
  const room = Math.max(0, max - frame.header.length - frame.footer.length);
  const window = lineWindow(frame.body.length, room, offset, frame.cursorLine, frame.cursorEnd);
  const borderIndex = frame.borderIndex ?? frame.header.length - 1;
  const header =
    window.above === 0 && window.below === 0
      ? frame.header
      : frame.header.map((line, index) =>
          index === borderIndex ? scrollBorder(width, window.above, window.below) : line,
        );
  const lines = [
    ...header,
    ...frame.body.slice(window.offset, window.offset + room),
    ...frame.footer,
  ];
  if (lines.length <= max) return { ...window, lines };
  const footer = frame.footer.slice(-max);
  return {
    ...window,
    lines: [...frame.header.slice(0, Math.max(0, max - footer.length)), ...footer],
  };
}

function scrollBorder(width: number, above: number, below: number): string {
  const hidden = [above > 0 ? `↑ ${above}` : undefined, below > 0 ? `↓ ${below}` : undefined]
    .filter(Boolean)
    .join(" · ");
  const text = ` ${hidden} more `;
  const labelWidth = visibleWidth(text);
  const rule = Math.max(0, width);
  if (labelWidth + 2 > rule) return theme.fg("borderMuted", "─".repeat(rule));
  const left = Math.floor((rule - labelWidth) / 2);
  return theme.fg(
    "borderMuted",
    `${"─".repeat(left)}${text}${"─".repeat(rule - left - labelWidth)}`,
  );
}

const scrollWindow = {
  fitView,
  lineWindow,
  scrollBorder,
};

export default scrollWindow;
