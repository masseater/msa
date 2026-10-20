import ansiSequences from "./ansi-sequences.ts";
import type ansiSequencesTypes from "./ansi-sequences.types.ts";

const { introducerOf, matchCsiSequence } = ansiSequences;

const KITTY_PRINTABLE_BODY = /^(\d+)(?::\d*)?(?::\d+)?$/u;

const ESC = "\x1b";
const TERMINAL_REPLY_HEADER_BODIES: ReadonlyArray<
  readonly [ansiSequencesTypes.EscapeKind, RegExp]
> = [
  ["osc", /^(?:1[01];|4;\d{1,3};|7501;\?)/u],
  ["dcs", /^>\|/u],
  ["apc", /^G(?:[a-z]=\d+,)*[a-z]=\d+;/u],
];

function startsWithTerminalReplyHeader(data: string): boolean {
  return TERMINAL_REPLY_HEADER_BODIES.some(
    ([kind, body]) => data.startsWith(introducerOf(kind)) && body.test(data.slice(2)),
  );
}

function isControlString(data: string): boolean {
  return data.startsWith(`${ESC}]`) || data.startsWith(`${ESC}P`) || data.startsWith(`${ESC}_`);
}

function isCompleteSequence(data: string): "complete" | "incomplete" | "not-escape" {
  if (!data.startsWith(ESC)) {
    return "not-escape";
  }

  if (data.length === 1) {
    return "incomplete";
  }

  const afterEsc = data.slice(1);

  if (afterEsc.startsWith("[")) {
    if (afterEsc.startsWith("[M")) {
      return data.length >= 6 ? "complete" : "incomplete";
    }
    return isCompleteCsiSequence(data);
  }

  if (afterEsc.startsWith("]")) {
    return isCompleteOscSequence(data);
  }

  if (afterEsc.startsWith("P")) {
    return isCompleteDcsSequence(data);
  }

  if (afterEsc.startsWith("_")) {
    return isCompleteApcSequence(data);
  }

  if (afterEsc.startsWith("O")) {
    return afterEsc.length >= 2 ? "complete" : "incomplete";
  }

  if (afterEsc.length === 1) {
    return "complete";
  }

  return "complete";
}

function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}[`)) {
    return "complete";
  }

  if (data.length < 3) {
    return "incomplete";
  }

  const payload = data.slice(2);

  const lastChar = payload.charAt(payload.length - 1);
  const lastCharCode = lastChar.charCodeAt(0);

  if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
    if (payload.startsWith("<")) {
      const mouseMatch = /^<\d+;\d+;\d+[Mm]$/u.test(payload);
      if (mouseMatch) {
        return "complete";
      }
      if (lastChar === "M" || lastChar === "m") {
        const parts = payload.slice(1, -1).split(";");
        if (parts.length === 3 && parts.every((p) => /^\d+$/u.test(p))) {
          return "complete";
        }
      }

      return "incomplete";
    }

    return "complete";
  }

  return "incomplete";
}

function isCompleteOscSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}]`)) {
    return "complete";
  }

  if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) {
    return "complete";
  }

  return "incomplete";
}

function isCompleteDcsSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}P`)) {
    return "complete";
  }

  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }

  return "incomplete";
}

function isCompleteApcSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}_`)) {
    return "complete";
  }

  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }

  return "incomplete";
}

function parseUnmodifiedKittyPrintableCodepoint(sequence: string): number | undefined {
  const match = matchCsiSequence({
    body: KITTY_PRINTABLE_BODY,
    data: sequence,
    finals: "u",
  })?.groups;
  if (match === undefined || match === null) return undefined;

  const codepoint = parseInt(match[1]!, 10);
  return codepoint >= 32 ? codepoint : undefined;
}

type EscapeScan = { readonly emitted: string | undefined; readonly advance: number };

const DOUBLE_ESCAPE_FOLLOWERS = new Set(["[", "]", "O", "P", "_"]);

function terminalReplyCut(remaining: string, seqEnd: number): EscapeScan | undefined {
  const char = remaining[seqEnd - 1];
  if (char === "\x18" || char === "\x1a") {
    return { advance: seqEnd, emitted: undefined };
  }
  if (char === ESC && seqEnd < remaining.length && remaining[seqEnd] !== "\\") {
    return { advance: seqEnd - 1, emitted: undefined };
  }
  return undefined;
}

function completedScan(remaining: string, candidate: string, seqEnd: number): EscapeScan {
  if (candidate === "\x1b\x1b" && DOUBLE_ESCAPE_FOLLOWERS.has(remaining[seqEnd] ?? "")) {
    return { advance: 1, emitted: ESC };
  }
  return { advance: seqEnd, emitted: candidate };
}

function scanEscapeSequence(remaining: string): EscapeScan | undefined {
  const terminalReply = isControlString(remaining) && startsWithTerminalReplyHeader(remaining);
  for (let seqEnd = 1; seqEnd <= remaining.length; seqEnd++) {
    const cut = terminalReply && seqEnd > 2 ? terminalReplyCut(remaining, seqEnd) : undefined;
    if (cut !== undefined) return cut;
    const candidate = remaining.slice(0, seqEnd);
    const status = isCompleteSequence(candidate);
    if (status === "complete") return completedScan(remaining, candidate, seqEnd);
    if (status === "not-escape") return { advance: seqEnd, emitted: candidate };
  }
  return undefined;
}

function extractCompleteSequences(buffer: string): {
  sequences: string[];
  remainder: string;
} {
  const sequences: string[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const remaining = buffer.slice(pos);
    if (!remaining.startsWith(ESC)) {
      sequences.push(remaining[0]!);
      pos++;
      continue;
    }
    const scan = scanEscapeSequence(remaining);
    if (scan === undefined) {
      return { remainder: remaining, sequences };
    }
    if (scan.emitted !== undefined) sequences.push(scan.emitted);
    pos += scan.advance;
  }

  return { remainder: "", sequences };
}

const stdinSequences = {
  ESC,
  extractCompleteSequences,
  isControlString,
  parseUnmodifiedKittyPrintableCodepoint,
  startsWithTerminalReplyHeader,
};

export default stdinSequences;
