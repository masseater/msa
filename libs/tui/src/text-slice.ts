import { dual } from "effect/Function";

import ansiSequences from "./ansi-sequences.ts";
import ansiTracker from "./ansi-tracker.ts";
import utils from "./utils.ts";

const { AnsiCodeTracker } = ansiTracker;
const { textUnits } = utils;
const { matchStringSequence } = ansiSequences;

interface SegmentRange {
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  strictAfter: boolean;
}

interface ExtractedSegments {
  before: string;
  beforeWidth: number;
  after: string;
  afterWidth: number;
}

interface SegmentState extends ExtractedSegments {
  pendingAnsiBefore: string;
  afterStarted: boolean;
}

const OSC8_BODY = /^8;[^;]*;(.*)$/su;

const pooledStyleTracker = new AnsiCodeTracker();

interface GraphemeCellRange {
  start: number;
  end: number;
}

const getGraphemeCellRange: {
  (line: string, column: number): GraphemeCellRange | undefined;
  (column: number): (line: string) => GraphemeCellRange | undefined;
} = dual(2, (line: string, column: number): GraphemeCellRange | undefined => {
  let currentCol = 0;
  for (const unit of textUnits(line)) {
    if (unit.ansi) continue;
    if (unit.width > 0 && column >= currentCol && column < currentCol + unit.width) {
      return { end: currentCol + unit.width, start: currentCol };
    }
    currentCol += unit.width;
  }
  return undefined;
});

const getOsc8LinkAtColumn: {
  (line: string, column: number): string | undefined;
  (column: number): (line: string) => string | undefined;
} = dual(2, (line: string, column: number): string | undefined => {
  let activeUrl: string | undefined;
  let currentCol = 0;
  for (const unit of textUnits(line)) {
    if (unit.ansi) {
      const hyperlink = matchStringSequence({ body: OSC8_BODY, data: unit.text, kind: "osc" });
      if (hyperlink !== null) activeUrl = hyperlink.groups[1] || undefined;
      continue;
    }
    if (column >= currentCol && column < currentCol + unit.width) return activeUrl;
    currentCol += unit.width;
  }
  return undefined;
});

const sliceWithWidth: {
  (
    line: string,
    startCol: number,
    length: number,
    strict?: boolean,
  ): { text: string; width: number };
  (
    startCol: number,
    length: number,
    strict?: boolean,
  ): (line: string) => { text: string; width: number };
} = dual(
  (args) => typeof args[0] === "string",
  (
    line: string,
    startCol: number,
    length: number,
    strict: boolean = false,
  ): { text: string; width: number } => {
    if (length <= 0) return { text: "", width: 0 };
    const endCol = startCol + length;
    let result = "";
    let resultWidth = 0;
    let currentCol = 0;
    let pendingAnsi = "";

    for (const unit of textUnits(line)) {
      if (unit.ansi) {
        if (currentCol >= startCol && currentCol < endCol) {
          result += pendingAnsi + unit.text;
          pendingAnsi = "";
        } else if (currentCol < startCol) pendingAnsi += unit.text;
        continue;
      }
      const inRange = currentCol >= startCol && currentCol < endCol;
      const fits = !strict || currentCol + unit.width <= endCol;
      if (inRange && fits) {
        result += pendingAnsi + unit.text;
        pendingAnsi = "";
        resultWidth += unit.width;
      }
      currentCol += unit.width;
      if (currentCol >= endCol) break;
    }
    return { text: result, width: resultWidth };
  },
);

const sliceByColumn: {
  (line: string, startCol: number, length: number, strict?: boolean): string;
  (startCol: number, length: number, strict?: boolean): (line: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (line: string, startCol: number, length: number, strict: boolean = false): string =>
    sliceWithWidth(line, startCol, length, strict).text,
);

function collectSegmentAnsi(
  state: SegmentState,
  code: string,
  currentCol: number,
  range: SegmentRange,
): void {
  pooledStyleTracker.process(code);
  if (currentCol < range.beforeEnd) {
    state.pendingAnsiBefore += code;
  } else if (
    currentCol >= range.afterStart &&
    currentCol < range.afterEnd &&
    (state.afterStarted || code.startsWith("\x1b_"))
  ) {
    state.after += code;
  }
}

function collectSegmentText(
  state: SegmentState,
  unit: { text: string; width: number },
  currentCol: number,
  range: SegmentRange,
): void {
  if (currentCol < range.beforeEnd && currentCol + unit.width <= range.beforeEnd) {
    state.before += state.pendingAnsiBefore + unit.text;
    state.pendingAnsiBefore = "";
    state.beforeWidth += unit.width;
    return;
  }
  const inAfter = currentCol >= range.afterStart && currentCol < range.afterEnd;
  if (!inAfter || (range.strictAfter && currentCol + unit.width > range.afterEnd)) return;
  if (!state.afterStarted) {
    state.after += pooledStyleTracker.getActiveCodes();
    state.afterStarted = true;
  }
  state.after += unit.text;
  state.afterWidth += unit.width;
}

const extractSegments: {
  (
    line: string,
    beforeEnd: number,
    afterStart: number,
    afterLen: number,
    strictAfter?: boolean,
  ): ExtractedSegments;
  (
    beforeEnd: number,
    afterStart: number,
    afterLen: number,
    strictAfter?: boolean,
  ): (line: string) => ExtractedSegments;
} = dual(
  (args) => typeof args[0] === "string",
  (
    line: string,
    beforeEnd: number,
    afterStart: number,
    afterLen: number,
    strictAfter: boolean = false,
  ): ExtractedSegments => {
    const range = { afterEnd: afterStart + afterLen, afterStart, beforeEnd, strictAfter };
    const stopCol = afterLen <= 0 ? beforeEnd : range.afterEnd;
    const state: SegmentState = {
      after: "",
      afterStarted: false,
      afterWidth: 0,
      before: "",
      beforeWidth: 0,
      pendingAnsiBefore: "",
    };
    let currentCol = 0;

    pooledStyleTracker.clear();
    for (const unit of textUnits(line)) {
      if (unit.ansi) {
        collectSegmentAnsi(state, unit.text, currentCol, range);
        continue;
      }
      collectSegmentText(state, unit, currentCol, range);
      currentCol += unit.width;
      if (currentCol >= stopCol) break;
    }

    const { before, beforeWidth, after, afterWidth } = state;
    return { after, afterWidth, before, beforeWidth };
  },
);

const textSlice = {
  extractSegments,
  getGraphemeCellRange,
  getOsc8LinkAtColumn,
  sliceByColumn,
  sliceWithWidth,
};

export default textSlice;
