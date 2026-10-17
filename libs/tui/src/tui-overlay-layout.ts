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

export interface OverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export type SizeValue = number | `${number}%`;

export interface OverlayOptions {
  width?: SizeValue;
  minWidth?: number;
  maxHeight?: SizeValue;

  anchor?: OverlayAnchor;
  offsetX?: number;
  offsetY?: number;

  row?: SizeValue;
  col?: SizeValue;

  margin?: OverlayMargin | number;

  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;
}

const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)%$/u;

function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
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
    return resolveAnchorRow(opt.anchor ?? "center", effectiveHeight, availHeight, marginTop);
  }
  if (typeof opt.row === "number") return opt.row;
  const rowPercent = opt.row.match(PERCENT_PATTERN)?.[1];
  if (rowPercent === undefined) {
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
    return resolveAnchorCol(opt.anchor ?? "center", width, availWidth, marginLeft);
  }
  if (typeof opt.col === "number") return opt.col;
  const colPercent = opt.col.match(PERCENT_PATTERN)?.[1];
  if (colPercent === undefined) {
    return resolveAnchorCol("center", width, availWidth, marginLeft);
  }
  const maxCol = Math.max(0, availWidth - width);
  const percent = parseFloat(colPercent) / 100;
  return marginLeft + Math.floor(maxCol * percent);
}

export function resolveOverlayLayout(
  options: OverlayOptions | undefined,
  overlayHeight: number,
  termWidth: number,
  termHeight: number,
): { width: number; row: number; col: number; maxHeight: number | undefined } {
  const opt = options ?? {};
  const margin = resolveMargin(opt.margin);

  const availWidth = Math.max(1, termWidth - margin.left - margin.right);
  const availHeight = Math.max(1, termHeight - margin.top - margin.bottom);

  let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
  if (opt.minWidth !== undefined) {
    width = Math.max(width, opt.minWidth);
  }
  width = Math.max(1, Math.min(width, availWidth));

  let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
  if (maxHeight !== undefined) {
    maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
  }

  const effectiveHeight =
    maxHeight === undefined ? overlayHeight : Math.min(overlayHeight, maxHeight);

  let row = resolveRow(opt, effectiveHeight, availHeight, margin.top);
  let col = resolveCol(opt, width, availWidth, margin.left);

  if (opt.offsetY !== undefined) row += opt.offsetY;
  if (opt.offsetX !== undefined) col += opt.offsetX;

  row = Math.max(margin.top, Math.min(row, termHeight - margin.bottom - effectiveHeight));
  col = Math.max(margin.left, Math.min(col, termWidth - margin.right - width));

  return { width, row, col, maxHeight };
}
