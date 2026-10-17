import { dual } from "effect/Function";

import { matchCsiSequence } from "./ansi-sequences.ts";
import {
  ARROW_CODEPOINTS,
  FUNCTIONAL_CODEPOINTS,
  LOCK_MASK,
  SHIFTED_SYMBOL_KEYS,
  SYMBOL_KEYS,
} from "./key-ids.ts";
import {
  getLogicalShiftedSymbolCandidate,
  normalizeKittyFunctionalCodepoint,
  normalizeShiftedLetterIdentityCodepoint,
} from "./key-sequences.ts";

export const KITTY_CSI_U_BODY = /^(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?$/u;
const MODIFIED_KEY_BODY = /^1;(\d+)(?::(\d+))?$/u;
const FUNCTION_KEY_BODY = /^(\d+)(?:;(\d+))?(?::(\d+))?$/u;
const MODIFY_OTHER_KEYS_BODY = /^27;(\d+);(\d+)$/u;
let kittyProtocolEnabled = false;

export function setKittyProtocolActive(active: boolean): void {
  kittyProtocolEnabled = active;
}

export function isKittyProtocolActive(): boolean {
  return kittyProtocolEnabled;
}

export type KeyEventType = "press" | "repeat" | "release";

interface ParsedKittySequence {
  codepoint: number;
  shiftedKey?: number | undefined;
  baseLayoutKey?: number | undefined;
  modifier: number;
  eventType: KeyEventType;
}

interface ParsedModifyOtherKeysSequence {
  codepoint: number;
  modifier: number;
}

export function isKeyRelease(data: string): boolean {
  if (data.includes("\x1b[200~")) {
    return false;
  }

  if (
    data.includes(":3u") ||
    data.includes(":3~") ||
    data.includes(":3A") ||
    data.includes(":3B") ||
    data.includes(":3C") ||
    data.includes(":3D") ||
    data.includes(":3H") ||
    data.includes(":3F")
  ) {
    return true;
  }
  return false;
}

export function isKeyRepeat(data: string): boolean {
  if (data.includes("\x1b[200~")) {
    return false;
  }

  if (
    data.includes(":2u") ||
    data.includes(":2~") ||
    data.includes(":2A") ||
    data.includes(":2B") ||
    data.includes(":2C") ||
    data.includes(":2D") ||
    data.includes(":2H") ||
    data.includes(":2F")
  ) {
    return true;
  }
  return false;
}

function parseEventType(eventTypeStr: string | undefined): KeyEventType {
  if (eventTypeStr === undefined || eventTypeStr === "") return "press";
  const eventType = parseInt(eventTypeStr, 10);
  if (eventType === 2) return "repeat";
  if (eventType === 3) return "release";
  return "press";
}

const ARROW_FINAL_CODEPOINTS: Record<string, number> = {
  A: ARROW_CODEPOINTS.up,
  B: ARROW_CODEPOINTS.down,
  C: ARROW_CODEPOINTS.right,
  D: ARROW_CODEPOINTS.left,
};

const FUNCTION_KEY_CODEPOINTS: Record<number, number> = {
  2: FUNCTIONAL_CODEPOINTS.insert,
  3: FUNCTIONAL_CODEPOINTS.delete,
  5: FUNCTIONAL_CODEPOINTS.pageUp,
  6: FUNCTIONAL_CODEPOINTS.pageDown,
  7: FUNCTIONAL_CODEPOINTS.home,
  8: FUNCTIONAL_CODEPOINTS.end,
};

function parseKittyCsiU(data: string): ParsedKittySequence | null {
  const csiU = matchCsiSequence({ data, finals: "u", body: KITTY_CSI_U_BODY });
  if (csiU === null) return null;
  const csiUMatch = csiU.groups;
  const codepoint = parseInt(csiUMatch[1]!, 10);
  const shiftedKey =
    csiUMatch[2] !== undefined && csiUMatch[2] !== "" && csiUMatch[2].length > 0
      ? parseInt(csiUMatch[2], 10)
      : undefined;
  const baseLayoutKey =
    csiUMatch[3] !== undefined && csiUMatch[3] !== "" ? parseInt(csiUMatch[3], 10) : undefined;
  const modValue =
    csiUMatch[4] !== undefined && csiUMatch[4] !== "" ? parseInt(csiUMatch[4], 10) : 1;
  const eventType = parseEventType(csiUMatch[5]);
  return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
}

function parseKittyArrow(data: string): ParsedKittySequence | null {
  const arrow = matchCsiSequence({ data, finals: "ABCD", body: MODIFIED_KEY_BODY });
  if (arrow === null) return null;
  const modValue = parseInt(arrow.groups[1]!, 10);
  const eventType = parseEventType(arrow.groups[2]);
  return { codepoint: ARROW_FINAL_CODEPOINTS[arrow.final]!, modifier: modValue - 1, eventType };
}

function parseKittyFunctionKey(data: string): ParsedKittySequence | null {
  const func = matchCsiSequence({ data, finals: "~", body: FUNCTION_KEY_BODY });
  if (func === null) return null;
  const funcMatch = func.groups;
  const keyNum = parseInt(funcMatch[1]!, 10);
  const modValue =
    funcMatch[2] !== undefined && funcMatch[2] !== "" ? parseInt(funcMatch[2], 10) : 1;
  const eventType = parseEventType(funcMatch[3]);
  const codepoint = FUNCTION_KEY_CODEPOINTS[keyNum];
  return codepoint === undefined ? null : { codepoint, modifier: modValue - 1, eventType };
}

function parseKittyHomeEnd(data: string): ParsedKittySequence | null {
  const homeEnd = matchCsiSequence({ data, finals: "HF", body: MODIFIED_KEY_BODY });
  if (homeEnd === null) return null;
  const modValue = parseInt(homeEnd.groups[1]!, 10);
  const eventType = parseEventType(homeEnd.groups[2]);
  const codepoint = homeEnd.final === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
  return { codepoint, modifier: modValue - 1, eventType };
}

export function parseKittySequence(data: string): ParsedKittySequence | null {
  return (
    parseKittyCsiU(data) ??
    parseKittyArrow(data) ??
    parseKittyFunctionKey(data) ??
    parseKittyHomeEnd(data)
  );
}

export const matchesKittySequence: {
  (data: string, expectedCodepoint: number, expectedModifier: number): boolean;
  (expectedCodepoint: number, expectedModifier: number): (data: string) => boolean;
} = dual(3, (data: string, expectedCodepoint: number, expectedModifier: number): boolean => {
  const parsed = parseKittySequence(data);
  if (parsed === null) return false;
  const actualMod = parsed.modifier & ~LOCK_MASK;
  const expectedMod = expectedModifier & ~LOCK_MASK;

  const normalizedCodepoint = normalizeShiftedLetterIdentityCodepoint(
    normalizeKittyFunctionalCodepoint(parsed.codepoint),
    parsed.modifier,
  );
  const normalizedExpectedCodepoint = normalizeShiftedLetterIdentityCodepoint(
    normalizeKittyFunctionalCodepoint(expectedCodepoint),
    expectedModifier,
  );

  if (actualMod === expectedMod && normalizedCodepoint === normalizedExpectedCodepoint) return true;

  const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(
    parsed.shiftedKey,
    actualMod,
    SYMBOL_KEYS,
  );
  if (
    logicalShiftedSymbol !== undefined &&
    (logicalShiftedSymbol.modifier & ~LOCK_MASK) === expectedMod &&
    logicalShiftedSymbol.codepoint === normalizeKittyFunctionalCodepoint(expectedCodepoint)
  ) {
    return true;
  }

  if (actualMod !== expectedMod) return false;

  if (parsed.baseLayoutKey !== undefined && parsed.baseLayoutKey === expectedCodepoint) {
    const cp = normalizedCodepoint;
    const isLatinLetter = cp >= 97 && cp <= 122;
    const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(cp));
    if (!isLatinLetter && !isKnownSymbol) return true;
  }

  return false;
});

export function parseModifyOtherKeysSequence(data: string): ParsedModifyOtherKeysSequence | null {
  const match = matchCsiSequence({ data, finals: "~", body: MODIFY_OTHER_KEYS_BODY })?.groups;
  if (match === undefined || match === null) return null;
  const modValue = parseInt(match[1]!, 10);
  const codepoint = parseInt(match[2]!, 10);
  return { codepoint, modifier: modValue - 1 };
}

export const matchesModifyOtherKeys: {
  (data: string, expectedKeycode: number, expectedModifier: number): boolean;
  (expectedKeycode: number, expectedModifier: number): (data: string) => boolean;
} = dual(3, (data: string, expectedKeycode: number, expectedModifier: number): boolean => {
  const parsed = parseModifyOtherKeysSequence(data);
  if (parsed === null) return false;
  return parsed.codepoint === expectedKeycode && parsed.modifier === expectedModifier;
});

export const matchesPrintableModifyOtherKeys: {
  (data: string, expectedKeycode: number, expectedModifier: number): boolean;
  (expectedKeycode: number, expectedModifier: number): (data: string) => boolean;
} = dual(3, (data: string, expectedKeycode: number, expectedModifier: number): boolean => {
  const parsed = parseModifyOtherKeysSequence(data);
  if (parsed === null) return false;
  const physicalMatch =
    parsed.modifier === expectedModifier &&
    normalizeShiftedLetterIdentityCodepoint(parsed.codepoint, parsed.modifier) ===
      normalizeShiftedLetterIdentityCodepoint(expectedKeycode, expectedModifier);
  if (physicalMatch) return true;
  const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(
    parsed.codepoint,
    parsed.modifier,
    SHIFTED_SYMBOL_KEYS,
  );
  return (
    logicalShiftedSymbol?.modifier === expectedModifier &&
    logicalShiftedSymbol.codepoint === expectedKeycode
  );
});
