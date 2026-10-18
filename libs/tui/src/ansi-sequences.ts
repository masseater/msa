import { ESC_CODE, type TOKEN, TOKEN_TYPES, tokenizer } from "@ansi-tools/parser";
import { dual } from "effect/Function";

export const CSI = `${ESC_CODE}[`;
const OSC = `${ESC_CODE}]`;
const DCS = `${ESC_CODE}P`;
const APC = `${ESC_CODE}_`;

export type EscapeKind = "csi" | "osc" | "dcs" | "apc";

export interface EscapeSequence {
  kind: EscapeKind;
  raw: string;
  body: string;
  final: string;
  terminator: string;
}

const introducerByKind: Record<EscapeKind, string> = {
  csi: CSI,
  osc: OSC,
  dcs: DCS,
  apc: APC,
};

const kindByIntroducer = new Map<string, EscapeKind>([
  [CSI, "csi"],
  [OSC, "osc"],
  [DCS, "dcs"],
  [APC, "apc"],
]);

export const introducerOf = (kind: EscapeKind): string => introducerByKind[kind];

type Segment = string | EscapeSequence;

function toSegment(introducer: TOKEN, data: readonly TOKEN[], final: TOKEN | undefined): Segment {
  const body = data.map((token) => token.raw).join("");
  const raw = `${introducer.raw}${body}${final?.raw ?? ""}`;
  const kind = kindByIntroducer.get(introducer.raw);
  if (kind === undefined || final === undefined) return raw;
  return {
    kind,
    raw,
    body,
    final: kind === "csi" ? final.raw : "",
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

export function parseEscapeSequence(text: string): EscapeSequence | null {
  const first = segments(text).next();
  if (first.done === true || typeof first.value === "string") return null;
  return first.value.raw.length === text.length ? first.value : null;
}

export function escapeSequences(text: string): EscapeSequence[] {
  if (!text.includes(ESC_CODE)) return [];
  return Array.from(segments(text)).filter(
    (segment): segment is EscapeSequence => typeof segment !== "string",
  );
}

const isStyleBody = (body: string): boolean => {
  for (const character of body) {
    if (character !== ";" && (character < "0" || character > "9")) return false;
  }
  return true;
};

export const isStyleSequence = (sequence: EscapeSequence): boolean =>
  sequence.kind === "csi" && sequence.final === "m" && isStyleBody(sequence.body);

export const replaceEscapeSequences: {
  (text: string, replacer: (sequence: EscapeSequence) => string): string;
  (replacer: (sequence: EscapeSequence) => string): (text: string) => string;
} = dual(2, (text: string, replacer: (sequence: EscapeSequence) => string): string => {
  if (!text.includes(ESC_CODE)) return text;
  let result = "";
  for (const segment of segments(text)) {
    result += typeof segment === "string" ? segment : replacer(segment);
  }
  return result;
});

const stripMatching = (text: string, keep: (sequence: EscapeSequence) => boolean): string =>
  replaceEscapeSequences(text, (sequence) => (keep(sequence) ? sequence.raw : ""));

export const leadingSequencesLength: {
  (text: string, accept: (sequence: EscapeSequence) => boolean): number;
  (accept: (sequence: EscapeSequence) => boolean): (text: string) => number;
} = dual(2, (text: string, accept: (sequence: EscapeSequence) => boolean): number => {
  let position = 0;
  for (const segment of segments(text)) {
    if (typeof segment === "string" || !accept(segment)) break;
    position += segment.raw.length;
  }
  return position;
});

const OSC133_ZONE_BODY = /^133;[ABC]$/u;

const isOsc133Zone = (sequence: EscapeSequence): boolean =>
  sequence.kind === "osc" && OSC133_ZONE_BODY.test(sequence.body);

export const stripOsc133ZonePrefix = (line: string): string =>
  line.slice(leadingSequencesLength(line, isOsc133Zone));

export const startsWithOsc133PromptStart = (line: string): boolean =>
  leadingSequencesLength(line, (sequence) => sequence.kind === "osc" && sequence.body === "133;A") >
  0;

export interface EscapeMatch {
  final: string;
  groups: RegExpExecArray;
}

export function matchCsiSequence(request: {
  data: string;
  finals: string;
  body: RegExp;
}): EscapeMatch | null {
  const sequence = parseEscapeSequence(request.data);
  if (sequence === null || sequence.kind !== "csi") return null;
  if (!request.finals.includes(sequence.final)) return null;
  const groups = request.body.exec(sequence.body);
  return groups === null ? null : { final: sequence.final, groups };
}

export function matchStringSequence(request: {
  data: string;
  kind: EscapeKind;
  body: RegExp;
}): EscapeMatch | null {
  const sequence = parseEscapeSequence(request.data);
  if (sequence === null || sequence.kind !== request.kind) return null;
  const groups = request.body.exec(sequence.body);
  return groups === null ? null : { final: sequence.terminator, groups };
}

export const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

export const replaceControlRuns: {
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

export const stripControlCharacters = (text: string): string =>
  Array.from(text)
    .filter((character) => !isControlCharacter(character))
    .join("");

export const stripStyleSequences = (text: string): string =>
  stripMatching(text, (sequence) => !isStyleSequence(sequence));

export const stripEscapeSequences = (text: string): string => stripMatching(text, () => false);

export const stripHyperlinkSequences = (text: string): string =>
  stripMatching(text, (sequence) => sequence.kind !== "osc" || !sequence.body.startsWith("8;"));
