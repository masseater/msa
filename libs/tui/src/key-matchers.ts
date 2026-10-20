import { dual } from "effect/Function";

import keyControlMatchers from "./key-control-matchers.ts";
import type keyControlMatchersTypes from "./key-control-matchers.types.ts";
import keyIds from "./key-ids.ts";
import type keyIdsTypes from "./key-ids.types.ts";
import keyProtocols from "./key-protocols.ts";
import keySequences from "./key-sequences.ts";
import type keySequencesTypes from "./key-sequences.types.ts";

const { ARROW_CODEPOINTS, MODIFIERS, MODIFIER_NAMES, SYMBOL_KEYS } = keyIds;
const { isKittyProtocolActive, matchesKittySequence, matchesPrintableModifyOtherKeys } =
  keyProtocols;
const {
  LEGACY_KEY_SEQUENCES,
  isDigitKey,
  matchesLegacyModifierSequence,
  matchesLegacySequence,
  rawCtrlChar,
} = keySequences;
const { matchesEditingControlKey, matchesNavigationKey } = keyControlMatchers;

function findModifierPrefix(key: string): (typeof MODIFIER_NAMES)[number] | undefined {
  return MODIFIER_NAMES.find((name) => key.startsWith(`${name}+`));
}

function parseKeyId(
  keyId: string,
): { key: string; ctrl: boolean; shift: boolean; alt: boolean; super: boolean } | null {
  let key = keyId.toLowerCase();
  const modifiers = new Set<(typeof MODIFIER_NAMES)[number]>();
  while (true) {
    const modifier = findModifierPrefix(key);
    if (modifier === undefined) break;
    if (modifiers.has(modifier)) return null;
    modifiers.add(modifier);
    key = key.slice(modifier.length + 1);
  }
  if (key === "" || (key.includes("+") && key !== "+")) return null;
  return {
    alt: modifiers.has("alt"),
    ctrl: modifiers.has("ctrl"),
    key,
    shift: modifiers.has("shift"),
    super: modifiers.has("super"),
  };
}

interface ArrowMatcher {
  readonly legacy: keySequencesTypes.LegacyModifierKey;
  readonly codepoint: number;
  readonly alt: readonly string[];
  readonly altWithoutKittyProtocol: readonly string[];
  readonly ctrl: readonly string[];
}

const ARROW_MATCHERS: Record<string, ArrowMatcher> = {
  down: {
    alt: ["\x1bn"],
    altWithoutKittyProtocol: [],
    codepoint: ARROW_CODEPOINTS.down,
    ctrl: [],
    legacy: "down",
  },
  left: {
    alt: ["\x1b[1;3D", "\x1bb"],
    altWithoutKittyProtocol: ["\x1bB"],
    codepoint: ARROW_CODEPOINTS.left,
    ctrl: ["\x1b[1;5D"],
    legacy: "left",
  },
  right: {
    alt: ["\x1b[1;3C", "\x1bf"],
    altWithoutKittyProtocol: ["\x1bF"],
    codepoint: ARROW_CODEPOINTS.right,
    ctrl: ["\x1b[1;5C"],
    legacy: "right",
  },
  up: {
    alt: ["\x1bp"],
    altWithoutKittyProtocol: [],
    codepoint: ARROW_CODEPOINTS.up,
    ctrl: [],
    legacy: "up",
  },
};

function matchesArrowKey(request: keyControlMatchersTypes.KeyMatchRequest): boolean | undefined {
  const { data, modifier } = request;
  const arrow = ARROW_MATCHERS[request.key];
  if (arrow === undefined) return undefined;
  if (modifier === MODIFIERS.alt) {
    return (
      arrow.alt.includes(data) ||
      (!isKittyProtocolActive() && arrow.altWithoutKittyProtocol.includes(data)) ||
      matchesKittySequence(data, arrow.codepoint, MODIFIERS.alt)
    );
  }
  if (modifier === 0) {
    return (
      matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[arrow.legacy]) ||
      matchesKittySequence(data, arrow.codepoint, 0)
    );
  }
  if (modifier === MODIFIERS.ctrl && arrow.ctrl.includes(data)) return true;
  return (
    matchesLegacyModifierSequence(data, arrow.legacy, modifier) ||
    matchesKittySequence(data, arrow.codepoint, modifier)
  );
}

function matchesFunctionKey(request: keyControlMatchersTypes.KeyMatchRequest): boolean | undefined {
  const { key, data, modifier } = request;
  switch (key) {
    case "f1":
    case "f2":
    case "f3":
    case "f4":
    case "f5":
    case "f6":
    case "f7":
    case "f8":
    case "f9":
    case "f10":
    case "f11":
    case "f12": {
      if (modifier !== 0) {
        return false;
      }
      const functionKey = key as keyof typeof LEGACY_KEY_SEQUENCES;
      return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[functionKey]);
    }
    default:
      return undefined;
  }
}

const matchesPrintableSequence = (data: string, codepoint: number, modifier: number): boolean =>
  matchesKittySequence(data, codepoint, modifier) ||
  matchesPrintableModifyOtherKeys(data, codepoint, modifier);

function matchesPrintableLegacyPrefix(key: string, data: string, modifier: number): boolean {
  if (isKittyProtocolActive()) return false;
  const rawCtrl = rawCtrlChar(key);
  if (modifier === MODIFIERS.ctrl + MODIFIERS.alt && rawCtrl !== null && rawCtrl !== "") {
    return data === `\x1b${rawCtrl}`;
  }
  return modifier === MODIFIERS.alt && data === `\x1b${key}`;
}

function matchesPrintableKeyWithModifier(key: string, data: string, modifier: number): boolean {
  const codepoint = key.charCodeAt(0);
  const isLetter = key >= "a" && key <= "z";

  if (modifier === MODIFIERS.ctrl) {
    const rawCtrl = rawCtrlChar(key);
    if (rawCtrl !== null && rawCtrl !== "" && data === rawCtrl) return true;
    return matchesPrintableSequence(data, codepoint, MODIFIERS.ctrl);
  }

  if (modifier === MODIFIERS.shift && isLetter && data === key.toUpperCase()) return true;

  if (modifier !== 0) return matchesPrintableSequence(data, codepoint, modifier);

  return data === key || matchesPrintableSequence(data, codepoint, 0);
}

function matchesPrintableKey(request: keyControlMatchersTypes.KeyMatchRequest): boolean {
  const { key, data, modifier } = request;
  if (key.length !== 1) return false;
  if (!(key >= "a" && key <= "z") && !isDigitKey(key) && !SYMBOL_KEYS.has(key)) return false;
  return (
    matchesPrintableLegacyPrefix(key, data, modifier) ||
    matchesPrintableKeyWithModifier(key, data, modifier)
  );
}

const KEY_MATCHERS = [
  matchesEditingControlKey,
  matchesNavigationKey,
  matchesArrowKey,
  matchesFunctionKey,
] as const;

const matchesKey: {
  (data: string, keyId: keyIdsTypes.KeyId): boolean;
  (keyId: keyIdsTypes.KeyId): (data: string) => boolean;
} = dual(2, (data: string, keyId: keyIdsTypes.KeyId): boolean => {
  const parsed = parseKeyId(keyId);
  if (parsed === null) return false;

  const { key, ctrl, shift, alt, super: superModifier } = parsed;
  let modifier = 0;
  if (shift) modifier |= MODIFIERS.shift;
  if (alt) modifier |= MODIFIERS.alt;
  if (ctrl) modifier |= MODIFIERS.ctrl;
  if (superModifier) modifier |= MODIFIERS.super;

  const request = { data, key, modifier };
  for (const matches of KEY_MATCHERS) {
    const result = matches(request);
    if (result !== undefined) return result;
  }

  return matchesPrintableKey(request);
});

const keyMatchers = {
  matchesKey,
};

export default keyMatchers;
