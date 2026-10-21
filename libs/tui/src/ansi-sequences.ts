import { ESC_CODE, type TOKEN, TOKEN_TYPES, tokenizer } from "@ansi-tools/parser";
import { dual } from "effect/Function";

import type ansiSequencesTypes from "./ansi-sequences.types.ts";

const CSI = `${ESC_CODE}[`;
const OSC = `${ESC_CODE}]`;
const DCS = `${ESC_CODE}P`;
const APC = `${ESC_CODE}_`;

const introducerByKind: Record<ansiSequencesTypes.EscapeKind, string> = {
  apc: APC,
  csi: CSI,
  dcs: DCS,
  osc: OSC,
};

const kindByIntroducer = new Map<string, ansiSequencesTypes.EscapeKind>([
  [CSI, "csi"],
  [OSC, "osc"],
  [DCS, "dcs"],
  [APC, "apc"],
]);

const introducerOf = (kind: ansiSequencesTypes.EscapeKind): string => introducerByKind[kind];

type Segment = string | ansiSequencesTypes.EscapeSequence;

function toSegment(introducer: TOKEN, data: readonly TOKEN[], final: TOKEN | undefined): Segment {
  const body = data.map((token) => token.raw).join("");
  const raw = `${introducer.raw}${body}${final?.raw ?? ""}`;
  const kind = kindByIntroducer.get(introducer.raw);
  if (kind === undefined || final === undefined) return raw;
  return {
    body,
    final: kind === "csi" ? final.raw : "",
    kind,
    raw,
    terminator: final.raw,
  };
}

function* segments(text: string): Generator<Segment> {
  let introducer: TOKEN | undefined;
  let data: TOKEN[] = [];
  for (const token of tokenizer(text)) {
    if (introducer !== undefined) {
      if (token.type === TOKEN_TYPES.DATA) {
        data.push(token);
        continue;
      }
      const final = token.type === TOKEN_TYPES.FINAL ? token : undefined;
      yield toSegment(introducer, data, final);
      introducer = undefined;
      if (final !== undefined) continue;
    }
    if (token.type === TOKEN_TYPES.INTRODUCER) {
      introducer = token;
      data = [];
      continue;
    }
    yield token.raw;
  }
  if (introducer !== undefined) yield toSegment(introducer, data, undefined);
}

function parseEscapeSequence(text: string): ansiSequencesTypes.EscapeSequence | null {
  const first = segments(text).next();
  if (first.done === true || typeof first.value === "string") return null;
  return first.value.raw.length === text.length ? first.value : null;
}

function escapeSequences(text: string): ansiSequencesTypes.EscapeSequence[] {
  if (!text.includes(ESC_CODE)) return [];
  return Array.from(segments(text)).filter(
    (segment): segment is ansiSequencesTypes.EscapeSequence => typeof segment !== "string",
  );
}

const isStyleBody = (body: string): boolean => {
  for (const character of body) {
    if (character !== ";" && (character < "0" || character > "9")) return false;
  }
  return true;
};

const isStyleSequence = (sequence: ansiSequencesTypes.EscapeSequence): boolean =>
  sequence.kind === "csi" && sequence.final === "m" && isStyleBody(sequence.body);

const replaceEscapeSequences: {
  (text: string, replacer: (sequence: ansiSequencesTypes.EscapeSequence) => string): string;
  (replacer: (sequence: ansiSequencesTypes.EscapeSequence) => string): (text: string) => string;
} = dual(
  2,
  (text: string, replacer: (sequence: ansiSequencesTypes.EscapeSequence) => string): string => {
    if (!text.includes(ESC_CODE)) return text;
    let result = "";
    for (const segment of segments(text)) {
      result += typeof segment === "string" ? segment : replacer(segment);
    }
    return result;
  },
);

const stripMatching = (
  text: string,
  keep: (sequence: ansiSequencesTypes.EscapeSequence) => boolean,
): string => replaceEscapeSequences(text, (sequence) => (keep(sequence) ? sequence.raw : ""));

const leadingSequencesLength: {
  (text: string, accept: (sequence: ansiSequencesTypes.EscapeSequence) => boolean): number;
  (accept: (sequence: ansiSequencesTypes.EscapeSequence) => boolean): (text: string) => number;
} = dual(
  2,
  (text: string, accept: (sequence: ansiSequencesTypes.EscapeSequence) => boolean): number => {
    let position = 0;
    for (const segment of segments(text)) {
      if (typeof segment === "string" || !accept(segment)) break;
      position += segment.raw.length;
    }
    return position;
  },
);

const OSC133_ZONE_BODY = /^133;[ABC]$/u;

const isOsc133Zone = (sequence: ansiSequencesTypes.EscapeSequence): boolean =>
  sequence.kind === "osc" && OSC133_ZONE_BODY.test(sequence.body);

const stripOsc133ZonePrefix = (line: string): string =>
  line.slice(leadingSequencesLength(line, isOsc133Zone));

const startsWithOsc133PromptStart = (line: string): boolean =>
  leadingSequencesLength(line, (sequence) => sequence.kind === "osc" && sequence.body === "133;A") >
  0;

function matchCsiSequence(request: {
  data: string;
  finals: string;
  body: RegExp;
}): ansiSequencesTypes.EscapeMatch | null {
  const sequence = parseEscapeSequence(request.data);
  if (sequence === null || sequence.kind !== "csi") return null;
  if (!request.finals.includes(sequence.final)) return null;
  const groups = request.body.exec(sequence.body);
  return groups === null ? null : { final: sequence.final, groups };
}

function matchStringSequence(request: {
  data: string;
  kind: ansiSequencesTypes.EscapeKind;
  body: RegExp;
}): ansiSequencesTypes.EscapeMatch | null {
  const sequence = parseEscapeSequence(request.data);
  if (sequence === null || sequence.kind !== request.kind) return null;
  const groups = request.body.exec(sequence.body);
  return groups === null ? null : { final: sequence.terminator, groups };
}

const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

const replaceControlRuns: {
  (text: string, replacement: string): string;
  (replacement: string): (text: string) => string;
} = dual(2, (text: string, replacement: string): string => {
  let result = "";
  let inRun = false;
  for (const character of text) {
    if (isControlCharacter(character)) {
      if (!inRun) result += replacement;
      inRun = true;
      continue;
    }
    inRun = false;
    result += character;
  }
  return result;
});

const stripControlCharacters = (text: string): string =>
  Array.from(text)
    .filter((character) => !isControlCharacter(character))
    .join("");

const stripStyleSequences = (text: string): string =>
  stripMatching(text, (sequence) => !isStyleSequence(sequence));

const stripEscapeSequences = (text: string): string => stripMatching(text, () => false);

const stripHyperlinkSequences = (text: string): string =>
  stripMatching(text, (sequence) => sequence.kind !== "osc" || !sequence.body.startsWith("8;"));

const ansiSequences = {
  CSI,
  escapeSequences,
  introducerOf,
  isControlCharacter,
  isStyleSequence,
  leadingSequencesLength,
  matchCsiSequence,
  matchStringSequence,
  parseEscapeSequence,
  replaceControlRuns,
  replaceEscapeSequences,
  startsWithOsc133PromptStart,
  stripControlCharacters,
  stripEscapeSequences,
  stripHyperlinkSequences,
  stripOsc133ZonePrefix,
  stripStyleSequences,
};

export default ansiSequences;
