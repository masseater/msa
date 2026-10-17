import { dual } from "effect/Function";

export const ESC = "\u001b";
export const BEL = "\u0007";
export const ST = `${ESC}\\`;
export const CSI = `${ESC}[`;
export const OSC = `${ESC}]`;
export const DCS = `${ESC}P`;
export const APC = `${ESC}_`;

export type EscapeKind = "csi" | "osc" | "dcs" | "apc";

export interface EscapeSequence {
  kind: EscapeKind;
  raw: string;
  body: string;
  final: string;
  terminator: string;
}

const kindByIntroducer = new Map<string, EscapeKind>([
  ["[", "csi"],
  ["]", "osc"],
  ["P", "dcs"],
  ["_", "apc"],
]);

const introducerByKind: Record<EscapeKind, string> = {
  csi: CSI,
  osc: OSC,
  dcs: DCS,
  apc: APC,
};

export const introducerOf = (kind: EscapeKind): string => introducerByKind[kind];

const isFinalByte = (code: number): boolean => code >= 0x40 && code <= 0x7e;

function scanCsi(text: string, start: number): EscapeSequence | null {
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isFinalByte(code)) {
      return {
        kind: "csi",
        raw: text.slice(start - CSI.length, index + 1),
        body: text.slice(start, index),
        final: text[index] ?? "",
        terminator: text[index] ?? "",
      };
    }
  }
  return null;
}

function scanString(text: string, start: number, kind: EscapeKind): EscapeSequence | null {
  for (let index = start; index < text.length; index++) {
    const terminator = text[index] === BEL ? BEL : text.startsWith(ST, index) ? ST : undefined;
    if (terminator === undefined) continue;
    return {
      kind,
      raw: text.slice(start - 2, index + terminator.length),
      body: text.slice(start, index),
      final: "",
      terminator,
    };
  }
  return null;
}

export const scanEscapeSequence: {
  (text: string, position: number): EscapeSequence | null;
  (position: number): (text: string) => EscapeSequence | null;
} = dual(2, (text: string, position: number): EscapeSequence | null => {
  if (text[position] !== ESC) return null;
  const introducer = text[position + 1];
  const kind = introducer === undefined ? undefined : kindByIntroducer.get(introducer);
  if (kind === undefined) return null;
  const start = position + 2;
  return kind === "csi" ? scanCsi(text, start) : scanString(text, start, kind);
});

export function parseEscapeSequence(text: string): EscapeSequence | null {
  const sequence = scanEscapeSequence(text, 0);
  return sequence !== null && sequence.raw.length === text.length ? sequence : null;
}

export function escapeSequences(text: string): EscapeSequence[] {
  const sequences: EscapeSequence[] = [];
  let index = text.indexOf(ESC);
  while (index !== -1) {
    const sequence = scanEscapeSequence(text, index);
    if (sequence === null) {
      index = text.indexOf(ESC, index + 1);
      continue;
    }
    sequences.push(sequence);
    index = text.indexOf(ESC, index + sequence.raw.length);
  }
  return sequences;
}

const isStyleBody = (body: string): boolean => {
  for (const character of body) {
    if (character !== ";" && (character < "0" || character > "9")) return false;
  }
  return true;
};

export const isStyleSequence = (sequence: EscapeSequence): boolean =>
  sequence.kind === "csi" && sequence.final === "m" && isStyleBody(sequence.body);

function stripMatching(text: string, keep: (sequence: EscapeSequence) => boolean): string {
  if (!text.includes(ESC)) return text;
  let result = "";
  let position = 0;
  while (position < text.length) {
    const sequence = scanEscapeSequence(text, position);
    if (sequence === null) {
      result += text[position];
      position += 1;
      continue;
    }
    if (keep(sequence)) result += sequence.raw;
    position += sequence.raw.length;
  }
  return result;
}

const OSC133_ZONE_BODY = /^133;[ABC]$/u;

const isOsc133Zone = (sequence: EscapeSequence): boolean =>
  sequence.kind === "osc" && OSC133_ZONE_BODY.test(sequence.body);

export const stripOsc133ZonePrefix = (line: string): string =>
  line.slice(leadingSequencesLength(line, isOsc133Zone));

export const startsWithOsc133PromptStart = (line: string): boolean => {
  const sequence = scanEscapeSequence(line, 0);
  return sequence !== null && sequence.kind === "osc" && sequence.body === "133;A";
};

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

export const replaceEscapeSequences: {
  (text: string, replacer: (sequence: EscapeSequence) => string): string;
  (replacer: (sequence: EscapeSequence) => string): (text: string) => string;
} = dual(2, (text: string, replacer: (sequence: EscapeSequence) => string): string => {
  if (!text.includes(ESC)) return text;
  let result = "";
  let position = 0;
  while (position < text.length) {
    const sequence = scanEscapeSequence(text, position);
    if (sequence === null) {
      result += text[position];
      position += 1;
      continue;
    }
    result += replacer(sequence);
    position += sequence.raw.length;
  }
  return result;
});

export const leadingSequencesLength: {
  (text: string, accept: (sequence: EscapeSequence) => boolean): number;
  (accept: (sequence: EscapeSequence) => boolean): (text: string) => number;
} = dual(2, (text: string, accept: (sequence: EscapeSequence) => boolean): number => {
  let position = 0;
  while (position < text.length) {
    const sequence = scanEscapeSequence(text, position);
    if (sequence === null || !accept(sequence)) break;
    position += sequence.raw.length;
  }
  return position;
});

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
