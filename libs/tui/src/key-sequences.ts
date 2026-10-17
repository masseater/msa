import { dual } from "effect/Function";

import { isEnvSet } from "./env.ts";
import {
  ARROW_CODEPOINTS,
  FUNCTIONAL_CODEPOINTS,
  type KeyId,
  LOCK_MASK,
  MODIFIERS,
} from "./key-ids.ts";

const KITTY_FUNCTIONAL_KEY_EQUIVALENTS = new Map<number, number>([
  [57399, 48],
  [57400, 49],
  [57401, 50],
  [57402, 51],
  [57403, 52],
  [57404, 53],
  [57405, 54],
  [57406, 55],
  [57407, 56],
  [57408, 57],
  [57409, 46],
  [57410, 47],
  [57411, 42],
  [57412, 45],
  [57413, 43],
  [57415, 61],
  [57416, 44],
  [57417, ARROW_CODEPOINTS.left],
  [57418, ARROW_CODEPOINTS.right],
  [57419, ARROW_CODEPOINTS.up],
  [57420, ARROW_CODEPOINTS.down],
  [57421, FUNCTIONAL_CODEPOINTS.pageUp],
  [57422, FUNCTIONAL_CODEPOINTS.pageDown],
  [57423, FUNCTIONAL_CODEPOINTS.home],
  [57424, FUNCTIONAL_CODEPOINTS.end],
  [57425, FUNCTIONAL_CODEPOINTS.insert],
  [57426, FUNCTIONAL_CODEPOINTS.delete],
]);

export function normalizeKittyFunctionalCodepoint(codepoint: number): number {
  return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
}

export const normalizeShiftedLetterIdentityCodepoint: {
  (codepoint: number, modifier: number): number;
  (modifier: number): (codepoint: number) => number;
} = dual(2, (codepoint: number, modifier: number): number => {
  const effectiveModifier = modifier & ~LOCK_MASK;
  if ((effectiveModifier & MODIFIERS.shift) !== 0 && codepoint >= 65 && codepoint <= 90) {
    return codepoint + 32;
  }
  return codepoint;
});

export const getLogicalShiftedSymbolCandidate: {
  (
    codepoint: number | undefined,
    modifier: number,
    allowedSymbols: ReadonlySet<string>,
  ): { codepoint: number; modifier: number } | undefined;
  (
    modifier: number,
    allowedSymbols: ReadonlySet<string>,
  ): (codepoint: number | undefined) => { codepoint: number; modifier: number } | undefined;
} = dual(
  3,
  (
    codepoint: number | undefined,
    modifier: number,
    allowedSymbols: ReadonlySet<string>,
  ): { codepoint: number; modifier: number } | undefined => {
    if (codepoint === undefined || (modifier & MODIFIERS.shift) === 0) return undefined;
    const normalizedCodepoint = normalizeKittyFunctionalCodepoint(codepoint);
    if (!allowedSymbols.has(String.fromCharCode(normalizedCodepoint))) return undefined;
    return { codepoint: normalizedCodepoint, modifier: modifier & ~MODIFIERS.shift };
  },
);

export const LEGACY_KEY_SEQUENCES = {
  up: ["\x1b[A", "\x1bOA"],
  down: ["\x1b[B", "\x1bOB"],
  right: ["\x1b[C", "\x1bOC"],
  left: ["\x1b[D", "\x1bOD"],
  home: ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"],
  end: ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"],
  insert: ["\x1b[2~"],
  delete: ["\x1b[3~"],
  pageUp: ["\x1b[5~", "\x1b[[5~"],
  pageDown: ["\x1b[6~", "\x1b[[6~"],
  clear: ["\x1b[E", "\x1bOE"],
  f1: ["\x1bOP", "\x1b[11~", "\x1b[[A"],
  f2: ["\x1bOQ", "\x1b[12~", "\x1b[[B"],
  f3: ["\x1bOR", "\x1b[13~", "\x1b[[C"],
  f4: ["\x1bOS", "\x1b[14~", "\x1b[[D"],
  f5: ["\x1b[15~", "\x1b[[E"],
  f6: ["\x1b[17~"],
  f7: ["\x1b[18~"],
  f8: ["\x1b[19~"],
  f9: ["\x1b[20~"],
  f10: ["\x1b[21~"],
  f11: ["\x1b[23~"],
  f12: ["\x1b[24~"],
} as const;

const LEGACY_SHIFT_SEQUENCES = {
  up: ["\x1b[a"],
  down: ["\x1b[b"],
  right: ["\x1b[c"],
  left: ["\x1b[d"],
  clear: ["\x1b[e"],
  insert: ["\x1b[2$"],
  delete: ["\x1b[3$"],
  pageUp: ["\x1b[5$"],
  pageDown: ["\x1b[6$"],
  home: ["\x1b[7$"],
  end: ["\x1b[8$"],
} as const;

const LEGACY_CTRL_SEQUENCES = {
  up: ["\x1bOa"],
  down: ["\x1bOb"],
  right: ["\x1bOc"],
  left: ["\x1bOd"],
  clear: ["\x1bOe"],
  insert: ["\x1b[2^"],
  delete: ["\x1b[3^"],
  pageUp: ["\x1b[5^"],
  pageDown: ["\x1b[6^"],
  home: ["\x1b[7^"],
  end: ["\x1b[8^"],
} as const;

export const LEGACY_SEQUENCE_KEY_IDS: Record<string, KeyId> = {
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1bOH": "home",
  "\x1bOF": "end",
  "\x1b[E": "clear",
  "\x1bOE": "clear",
  "\x1bOe": "ctrl+clear",
  "\x1b[e": "shift+clear",
  "\x1b[2~": "insert",
  "\x1b[2$": "shift+insert",
  "\x1b[2^": "ctrl+insert",
  "\x1b[3$": "shift+delete",
  "\x1b[3^": "ctrl+delete",
  "\x1b[[5~": "pageUp",
  "\x1b[[6~": "pageDown",
  "\x1b[a": "shift+up",
  "\x1b[b": "shift+down",
  "\x1b[c": "shift+right",
  "\x1b[d": "shift+left",
  "\x1bOa": "ctrl+up",
  "\x1bOb": "ctrl+down",
  "\x1bOc": "ctrl+right",
  "\x1bOd": "ctrl+left",
  "\x1b[5$": "shift+pageUp",
  "\x1b[6$": "shift+pageDown",
  "\x1b[7$": "shift+home",
  "\x1b[8$": "shift+end",
  "\x1b[5^": "ctrl+pageUp",
  "\x1b[6^": "ctrl+pageDown",
  "\x1b[7^": "ctrl+home",
  "\x1b[8^": "ctrl+end",
  "\x1bOP": "f1",
  "\x1bOQ": "f2",
  "\x1bOR": "f3",
  "\x1bOS": "f4",
  "\x1b[11~": "f1",
  "\x1b[12~": "f2",
  "\x1b[13~": "f3",
  "\x1b[14~": "f4",
  "\x1b[[A": "f1",
  "\x1b[[B": "f2",
  "\x1b[[C": "f3",
  "\x1b[[D": "f4",
  "\x1b[[E": "f5",
  "\x1b[15~": "f5",
  "\x1b[17~": "f6",
  "\x1b[18~": "f7",
  "\x1b[19~": "f8",
  "\x1b[20~": "f9",
  "\x1b[21~": "f10",
  "\x1b[23~": "f11",
  "\x1b[24~": "f12",
  "\x1bb": "alt+left",
  "\x1bf": "alt+right",
  "\x1bp": "alt+up",
  "\x1bn": "alt+down",
} as const;

export type LegacyModifierKey = keyof typeof LEGACY_SHIFT_SEQUENCES;

export const matchesLegacySequence: {
  (data: string, sequences: readonly string[]): boolean;
  (sequences: readonly string[]): (data: string) => boolean;
} = dual(2, (data: string, sequences: readonly string[]): boolean => sequences.includes(data));

export const matchesLegacyModifierSequence: {
  (data: string, key: LegacyModifierKey, modifier: number): boolean;
  (key: LegacyModifierKey, modifier: number): (data: string) => boolean;
} = dual(3, (data: string, key: LegacyModifierKey, modifier: number): boolean => {
  if (modifier === MODIFIERS.shift) {
    return matchesLegacySequence(data, LEGACY_SHIFT_SEQUENCES[key]);
  }
  if (modifier === MODIFIERS.ctrl) {
    return matchesLegacySequence(data, LEGACY_CTRL_SEQUENCES[key]);
  }
  return false;
});

export function isWindowsTerminalSession(): boolean {
  return (
    isEnvSet("WT_SESSION") &&
    !isEnvSet("SSH_CONNECTION") &&
    !isEnvSet("SSH_CLIENT") &&
    !isEnvSet("SSH_TTY")
  );
}

export const matchesRawBackspace: {
  (data: string, expectedModifier: number): boolean;
  (expectedModifier: number): (data: string) => boolean;
} = dual(2, (data: string, expectedModifier: number): boolean => {
  if (data === "\x7f") return expectedModifier === 0;
  if (data !== "\x08") return false;
  return isWindowsTerminalSession() ? expectedModifier === MODIFIERS.ctrl : expectedModifier === 0;
});

export function rawCtrlChar(key: string): string | null {
  const char = key.toLowerCase();
  const code = char.charCodeAt(0);
  if (
    (code >= 97 && code <= 122) ||
    char === "[" ||
    char === "\\" ||
    char === "]" ||
    char === "_"
  ) {
    return String.fromCharCode(code & 0x1f);
  }
  if (char === "-") {
    return String.fromCharCode(31);
  }
  return null;
}

export function isDigitKey(key: string): boolean {
  return key >= "0" && key <= "9";
}
