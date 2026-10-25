const FENCE = /^\s*(?:```|~~~)/u;
const LIST_MARKER = /^\s*(?:[-*+•]\s+|・\s*|\d{1,3}[.)]\s+)/u;
const ENUMERATOR = /[(（](\d{1,2})[)）]|([①-⑳])/gu;
const AFTER_SENTENCE = /[。．.:：;；!！?？]\s*$/u;
const OPENERS = "(（「『[【";
const CLOSERS = ")）」』]】";
const FULL_STOPS = "。！？";
const STOPS = ".!?";
const CIRCLED_ONE = 0x24_60;

interface Block {
  indent: number;
  lines: string[];
  list: boolean;
  code: boolean;
}

interface Mark {
  start: number;
  end: number;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function fencedRanges(text: string): Mark[] {
  const ranges: Mark[] = [];
  let offset = 0;
  let open: number | undefined;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      if (open === undefined) open = offset;
      else {
        ranges.push({ end: offset + line.length, start: open });
        open = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (open !== undefined) ranges.push({ end: text.length, start: open });
  return ranges;
}

function startsAnItem(text: string, index: number): boolean {
  const before = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
  return before.trim() === "" || AFTER_SENTENCE.test(before);
}

function enumerators(text: string): Mark[] {
  const fenced = fencedRanges(text);
  const marks: Mark[] = [];
  for (const match of text.matchAll(ENUMERATOR)) {
    const value =
      match[1] === undefined ? (match[2]?.codePointAt(0) ?? 0) - CIRCLED_ONE + 1 : Number(match[1]);
    const start = match.index;
    const inCode = fenced.some((range) => start >= range.start && start < range.end);
    if (value !== marks.length + 1 || inCode || !startsAnItem(text, start)) continue;
    marks.push({ end: start + match[0].length, start });
  }
  return marks.length >= 2 ? marks : [];
}

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  let blank = false;
  let fenced = false;
  for (const line of text.split("\n")) {
    const fence = FENCE.test(line);
    if (fenced || fence) {
      if (fence) fenced = !fenced;
      if (current === undefined) {
        current = { code: true, indent: indentOf(line), lines: [], list: false };
        blocks.push(current);
      }
      current.lines.push(line);
      current.code = true;
      blank = false;
      continue;
    }
    if (line.trim() === "") {
      blank = true;
      continue;
    }
    const indent = indentOf(line);
    const marker = LIST_MARKER.exec(line);
    const nested = current !== undefined && indent > current.indent;
    if (current !== undefined && (nested || (!blank && !current.list && marker === null))) {
      current.lines.push(line.trim());
    } else {
      current = {
        code: false,
        indent,
        lines: [marker === null ? line.trim() : line.slice(marker[0].length)],
        list: marker !== null,
      };
      blocks.push(current);
    }
    blank = false;
  }
  return blocks;
}

function endsSentence(text: string, index: number): boolean {
  const char = text[index] ?? "";
  if (FULL_STOPS.includes(char)) return true;
  return STOPS.includes(char) && /\s/u.test(text[index + 1] ?? "");
}

function sentences(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (char === "`") quoted = !quoted;
    if (quoted || char === "`") continue;
    if (OPENERS.includes(char)) depth++;
    else if (CLOSERS.includes(char)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && endsSentence(text, index)) {
      found.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  found.push(text.slice(start));
  return found;
}

function plainItems(text: string): string[] {
  return blocksOf(text).flatMap((block) => {
    const joined = block.lines.join("\n");
    return block.list || block.code ? [joined] : sentences(joined);
  });
}

function goalItems(goalState: string): string[] {
  const marks = enumerators(goalState);
  const first = marks[0];
  const items =
    first === undefined
      ? plainItems(goalState)
      : [
          ...plainItems(goalState.slice(0, first.start)),
          ...marks.map((mark, index) =>
            goalState.slice(mark.end, marks[index + 1]?.start ?? goalState.length),
          ),
        ];
  const kept = items.map((item) => item.trim()).filter((item) => item !== "");
  return kept.length > 0 ? kept : [goalState.trim()];
}

const goalItemsModule = { goalItems };

export default goalItemsModule;
