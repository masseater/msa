import { dual } from "effect/Function";

import ansiTracker from "./ansi-tracker.ts";
import utils from "./utils.ts";

const { isPrintableAscii, textUnits, visibleWidth } = utils;
const { getActiveOsc8Close } = ansiTracker;

interface TruncateRequest {
  text: string;
  maxWidth: number;
  ellipsis: string;
  ellipsisWidth: number;
  pad: boolean;
}

interface TruncateScan {
  result: string;
  keptWidth: number;
  visibleSoFar: number;
  overflowed: boolean;
}

function truncateFragmentToWidth(text: string, maxWidth: number): { text: string; width: number } {
  if (maxWidth <= 0 || text.length === 0) {
    return { text: "", width: 0 };
  }

  if (isPrintableAscii(text)) {
    const clipped = text.slice(0, maxWidth);
    return { text: clipped, width: clipped.length };
  }

  let result = "";
  let width = 0;
  let pendingAnsi = "";
  for (const unit of textUnits(text)) {
    if (unit.ansi) {
      pendingAnsi += unit.text;
      continue;
    }
    if (width + unit.width > maxWidth) {
      break;
    }
    result += pendingAnsi + unit.text;
    pendingAnsi = "";
    width += unit.width;
  }
  return { text: result, width };
}

function finalizeTruncatedResult(
  request: TruncateRequest,
  prefix: string,
  prefixWidth: number,
  ellipsis: { text: string; width: number },
): string {
  const reset = "\x1b[0m";
  const hyperlinkClose = getActiveOsc8Close(prefix);
  const contentWidth = prefixWidth + ellipsis.width;
  const result =
    ellipsis.text.length > 0
      ? `${prefix}${hyperlinkClose}${reset}${ellipsis.text}${reset}`
      : `${prefix}${hyperlinkClose}${reset}`;

  return request.pad ? result + " ".repeat(Math.max(0, request.maxWidth - contentWidth)) : result;
}

function padded(request: TruncateRequest, textWidth: number): string {
  return request.pad
    ? request.text + " ".repeat(Math.max(0, request.maxWidth - textWidth))
    : request.text;
}

function truncateToEllipsis(request: TruncateRequest): string {
  const textWidth = visibleWidth(request.text);
  if (textWidth <= request.maxWidth) {
    return padded(request, textWidth);
  }
  const clippedEllipsis = truncateFragmentToWidth(request.ellipsis, request.maxWidth);
  if (clippedEllipsis.width === 0) {
    return request.pad ? " ".repeat(request.maxWidth) : "";
  }
  return finalizeTruncatedResult(request, "", 0, clippedEllipsis);
}

function scanTruncation(request: TruncateRequest): TruncateScan {
  const targetWidth = request.maxWidth - request.ellipsisWidth;
  const scan: TruncateScan = { keptWidth: 0, overflowed: false, result: "", visibleSoFar: 0 };
  let pendingAnsi = "";
  let keepContiguousPrefix = true;

  for (const unit of textUnits(request.text)) {
    if (unit.ansi) {
      pendingAnsi += unit.text;
      continue;
    }
    if (keepContiguousPrefix && scan.keptWidth + unit.width <= targetWidth) {
      scan.result += pendingAnsi + unit.text;
      scan.keptWidth += unit.width;
    } else {
      keepContiguousPrefix = false;
    }
    pendingAnsi = "";
    scan.visibleSoFar += unit.width;
    if (scan.visibleSoFar > request.maxWidth) {
      scan.overflowed = true;
      break;
    }
  }
  return scan;
}

function truncateRequest(request: TruncateRequest): string {
  if (request.ellipsisWidth >= request.maxWidth) {
    return truncateToEllipsis(request);
  }

  const ellipsis = { text: request.ellipsis, width: request.ellipsisWidth };
  if (isPrintableAscii(request.text)) {
    if (request.text.length <= request.maxWidth) {
      return padded(request, request.text.length);
    }
    const targetWidth = request.maxWidth - request.ellipsisWidth;
    return finalizeTruncatedResult(
      request,
      request.text.slice(0, targetWidth),
      targetWidth,
      ellipsis,
    );
  }

  const scan = scanTruncation(request);
  if (!scan.overflowed) {
    return padded(request, scan.visibleSoFar);
  }
  return finalizeTruncatedResult(request, scan.result, scan.keptWidth, ellipsis);
}

const truncateToWidth: {
  (text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;
  (maxWidth: number, ellipsis?: string, pad?: boolean): (text: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (text: string, maxWidth: number, ellipsis: string = "...", pad: boolean = false): string => {
    if (maxWidth <= 0) {
      return "";
    }
    if (text.length === 0) {
      return pad ? " ".repeat(maxWidth) : "";
    }
    return truncateRequest({
      ellipsis,
      ellipsisWidth: visibleWidth(ellipsis),
      maxWidth,
      pad,
      text,
    });
  },
);

const textTruncate = {
  truncateToWidth,
};

export default textTruncate;
