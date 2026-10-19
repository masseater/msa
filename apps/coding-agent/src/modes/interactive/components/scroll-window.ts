import { visibleWidth } from "@msa/tui";

import { theme } from "../theme/theme.ts";

/** What a view draws around its body: the header above, the hints or composer below. */
export interface ViewFrame {
  header: string[];
  body: string[];
  footer: string[];
  /** First line of `body` the cursor sits on, when the view has one. */
  cursorLine?: number | undefined;
  /** Last line the cursor row spans; a row of a title and its detail keeps both visible. */
  cursorEnd?: number | undefined;
  /** Line of `header` that rules off the body and carries the hidden-line label. */
  borderIndex?: number | undefined;
}

/** The rows of a frame that fit, and where the window sits in the body. */
export interface FittedView {
  lines: string[];
  /** First body line drawn; pass it back to keep the window where the user left it. */
  offset: number;
  /** Body lines hidden above the window. */
  above: number;
  /** Body lines hidden below the window. */
  below: number;
}

/**
 * Picks which lines of a body fit in `height` rows, keeping `cursorLine` inside the window and
 * moving `offset` as little as possible. A body that shrank since the last frame pulls the window
 * back up, so a shorter body leaves no blank rows at the bottom.
 */
export function lineWindow(
  lines: number,
  height: number,
  offset: number,
  cursorLine?: number,
  cursorEnd = cursorLine,
): Omit<FittedView, "lines"> {
  const maxOffset = Math.max(0, lines - height);
  let start = offset;
  if (cursorLine !== undefined && cursorEnd !== undefined) {
    if (cursorLine < start) start = cursorLine;
    else if (cursorEnd >= start + height) start = cursorEnd - height + 1;
  }
  start = Math.max(0, Math.min(start, maxOffset));
  return { offset: start, above: start, below: Math.max(0, lines - start - height) };
}

/** Draws a frame in at most `max` rows: the header and footer stay put and the body scrolls. */
export function fitView(frame: ViewFrame, width: number, max: number, offset: number): FittedView {
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

/** A horizontal rule that names the body lines hidden above or below it, like the editor border. */
export function scrollBorder(width: number, above: number, below: number): string {
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
