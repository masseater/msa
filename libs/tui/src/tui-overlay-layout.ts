/**
 * Anchor position for overlays
 */
export type OverlayAnchor =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center"
  | "left-center"
  | "right-center";

/**
 * Margin configuration for overlays
 */
export interface OverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Value that can be absolute (number) or percentage (string like "50%") */
export type SizeValue = number | `${number}%`;

/**
 * Options for overlay positioning and sizing.
 * Values can be absolute numbers or percentage strings (e.g., "50%").
 */
export interface OverlayOptions {
  // === Sizing ===
  /** Width in columns, or percentage of terminal width (e.g., "50%") */
  width?: SizeValue;
  /** Minimum width in columns */
  minWidth?: number;
  /** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
  maxHeight?: SizeValue;

  // === Positioning - anchor-based ===
  /** Anchor point for positioning (default: 'center') */
  anchor?: OverlayAnchor;
  /** Horizontal offset from anchor position (positive = right) */
  offsetX?: number;
  /** Vertical offset from anchor position (positive = down) */
  offsetY?: number;

  // === Positioning - percentage or absolute ===
  /** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
  row?: SizeValue;
  /** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
  col?: SizeValue;

  // === Margin from terminal edges ===
  /** Margin from terminal edges. Number applies to all sides. */
  margin?: OverlayMargin | number;

  // === Visibility ===
  /**
   * Control overlay visibility based on terminal dimensions.
   * If provided, overlay is only rendered when this returns true.
   * Called each render cycle with current terminal dimensions.
   */
  visible?: (termWidth: number, termHeight: number) => boolean;
  /** If true, don't capture keyboard focus when shown */
  nonCapturing?: boolean;
}

const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)%$/u;

/**
 * Parse a SizeValue into absolute value given a reference size
 *
 * @param {SizeValue | undefined} value - An absolute size or a percentage.
 * @param {number} referenceSize - The size a percentage refers to.
 * @returns {number | undefined} The absolute size, or undefined when `value` is undefined.
 */
function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  // Parse percentage string like "50%"
  const percent = value.match(PERCENT_PATTERN)?.[1];
  if (percent !== undefined) {
    return Math.floor((referenceSize * parseFloat(percent)) / 100);
  }
  return undefined;
}

function resolveAnchorRow(
  anchor: OverlayAnchor,
  height: number,
  availHeight: number,
  marginTop: number,
): number {
  switch (anchor) {
    case "top-left":
    case "top-center":
    case "top-right":
      return marginTop;
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
      return marginTop + availHeight - height;
    case "left-center":
    case "center":
    case "right-center":
      return marginTop + Math.floor((availHeight - height) / 2);
  }
}

function resolveAnchorCol(
  anchor: OverlayAnchor,
  width: number,
  availWidth: number,
  marginLeft: number,
): number {
  switch (anchor) {
    case "top-left":
    case "left-center":
    case "bottom-left":
      return marginLeft;
    case "top-right":
    case "right-center":
    case "bottom-right":
      return marginLeft + availWidth - width;
    case "top-center":
    case "center":
    case "bottom-center":
      return marginLeft + Math.floor((availWidth - width) / 2);
  }
}

interface ResolvedMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Parse margin (clamp to non-negative)
function resolveMargin(margin: OverlayOptions["margin"]): ResolvedMargin {
  const sides =
    typeof margin === "number"
      ? { top: margin, right: margin, bottom: margin, left: margin }
      : (margin ?? {});
  return {
    top: Math.max(0, sides.top ?? 0),
    right: Math.max(0, sides.right ?? 0),
    bottom: Math.max(0, sides.bottom ?? 0),
    left: Math.max(0, sides.left ?? 0),
  };
}

function resolveRow(
  opt: OverlayOptions,
  effectiveHeight: number,
  availHeight: number,
  marginTop: number,
): number {
  if (opt.row === undefined) {
    // Anchor-based (default: center)
    return resolveAnchorRow(opt.anchor ?? "center", effectiveHeight, availHeight, marginTop);
  }
  // Absolute row position
  if (typeof opt.row === "number") return opt.row;
  // Percentage: 0% = top, 100% = bottom (overlay stays within bounds)
  const rowPercent = opt.row.match(PERCENT_PATTERN)?.[1];
  if (rowPercent === undefined) {
    // Invalid format, fall back to center
    return resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
  }
  const maxRow = Math.max(0, availHeight - effectiveHeight);
  const percent = parseFloat(rowPercent) / 100;
  return marginTop + Math.floor(maxRow * percent);
}

function resolveCol(
  opt: OverlayOptions,
  width: number,
  availWidth: number,
  marginLeft: number,
): number {
  if (opt.col === undefined) {
    // Anchor-based (default: center)
    return resolveAnchorCol(opt.anchor ?? "center", width, availWidth, marginLeft);
  }
  // Absolute column position
  if (typeof opt.col === "number") return opt.col;
  // Percentage: 0% = left, 100% = right (overlay stays within bounds)
  const colPercent = opt.col.match(PERCENT_PATTERN)?.[1];
  if (colPercent === undefined) {
    // Invalid format, fall back to center
    return resolveAnchorCol("center", width, availWidth, marginLeft);
  }
  const maxCol = Math.max(0, availWidth - width);
  const percent = parseFloat(colPercent) / 100;
  return marginLeft + Math.floor(maxCol * percent);
}

/**
 * Resolve overlay layout from options.
 * Returns { width, row, col, maxHeight } for rendering.
 *
 * @param {OverlayOptions | undefined} options - Overlay positioning and sizing options.
 * @param {number} overlayHeight - Rendered height of the overlay in rows.
 * @param {number} termWidth - Terminal width in columns.
 * @param {number} termHeight - Terminal height in rows.
 * @returns {{ width: number; row: number; col: number; maxHeight: number | undefined }} The overlay width, position, and maximum height.
 */
export function resolveOverlayLayout(
  options: OverlayOptions | undefined,
  overlayHeight: number,
  termWidth: number,
  termHeight: number,
): { width: number; row: number; col: number; maxHeight: number | undefined } {
  const opt = options ?? {};
  const margin = resolveMargin(opt.margin);

  // Available space after margins
  const availWidth = Math.max(1, termWidth - margin.left - margin.right);
  const availHeight = Math.max(1, termHeight - margin.top - margin.bottom);

  // === Resolve width ===
  let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
  // Apply minWidth
  if (opt.minWidth !== undefined) {
    width = Math.max(width, opt.minWidth);
  }
  // Clamp to available space
  width = Math.max(1, Math.min(width, availWidth));

  // === Resolve maxHeight ===
  let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
  // Clamp to available space
  if (maxHeight !== undefined) {
    maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
  }

  // Effective overlay height (may be clamped by maxHeight)
  const effectiveHeight =
    maxHeight === undefined ? overlayHeight : Math.min(overlayHeight, maxHeight);

  // === Resolve position ===
  let row = resolveRow(opt, effectiveHeight, availHeight, margin.top);
  let col = resolveCol(opt, width, availWidth, margin.left);

  // Apply offsets
  if (opt.offsetY !== undefined) row += opt.offsetY;
  if (opt.offsetX !== undefined) col += opt.offsetX;

  // Clamp to terminal bounds (respecting margins)
  row = Math.max(margin.top, Math.min(row, termHeight - margin.bottom - effectiveHeight));
  col = Math.max(margin.left, Math.min(col, termWidth - margin.right - width));

  return { width, row, col, maxHeight };
}
