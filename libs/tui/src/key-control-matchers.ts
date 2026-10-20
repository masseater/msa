import type keyControlMatchersTypes from "./key-control-matchers.types.ts";
import keyIds from "./key-ids.ts";
import keyProtocols from "./key-protocols.ts";
import keySequences from "./key-sequences.ts";
import type keySequencesTypes from "./key-sequences.types.ts";

const { isKittyProtocolActive, matchesKittySequence, matchesModifyOtherKeys } = keyProtocols;
const { CODEPOINTS, FUNCTIONAL_CODEPOINTS, MODIFIERS } = keyIds;
const {
  LEGACY_KEY_SEQUENCES,
  matchesLegacyModifierSequence,
  matchesLegacySequence,
  matchesRawBackspace,
} = keySequences;

function matchesEscapeKey(data: string, modifier: number): boolean {
  if (modifier !== 0) return false;
  return (
    data === "\x1b" ||
    matchesKittySequence(data, CODEPOINTS.escape, 0) ||
    matchesModifyOtherKeys(data, CODEPOINTS.escape, 0)
  );
}

function matchesSpaceKey(data: string, modifier: number): boolean {
  if (!isKittyProtocolActive()) {
    if (modifier === MODIFIERS.ctrl && data === "\x00") {
      return true;
    }
    if (modifier === MODIFIERS.alt && data === "\x1b ") {
      return true;
    }
  }
  if (modifier === 0) {
    return (
      data === " " ||
      matchesKittySequence(data, CODEPOINTS.space, 0) ||
      matchesModifyOtherKeys(data, CODEPOINTS.space, 0)
    );
  }
  return (
    matchesKittySequence(data, CODEPOINTS.space, modifier) ||
    matchesModifyOtherKeys(data, CODEPOINTS.space, modifier)
  );
}

function matchesTabKey(data: string, modifier: number): boolean {
  if (modifier === MODIFIERS.shift) {
    return (
      data === "\x1b[Z" ||
      matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift) ||
      matchesModifyOtherKeys(data, CODEPOINTS.tab, MODIFIERS.shift)
    );
  }
  if (modifier === 0) {
    return data === "\t" || matchesKittySequence(data, CODEPOINTS.tab, 0);
  }
  return (
    matchesKittySequence(data, CODEPOINTS.tab, modifier) ||
    matchesModifyOtherKeys(data, CODEPOINTS.tab, modifier)
  );
}

function matchesEnterSequence(data: string, modifier: number): boolean {
  return (
    matchesKittySequence(data, CODEPOINTS.enter, modifier) ||
    matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) ||
    matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier)
  );
}

function matchesEnterKey(data: string, modifier: number): boolean {
  if (modifier === MODIFIERS.shift) {
    if (matchesEnterSequence(data, MODIFIERS.shift)) return true;
    return isKittyProtocolActive() && (data === "\x1b\r" || data === "\n");
  }
  if (modifier === MODIFIERS.alt) {
    if (matchesEnterSequence(data, MODIFIERS.alt)) return true;
    return !isKittyProtocolActive() && data === "\x1b\r";
  }
  if (modifier === 0) {
    return (
      data === "\r" ||
      (!isKittyProtocolActive() && data === "\n") ||
      data === "\x1bOM" ||
      matchesKittySequence(data, CODEPOINTS.enter, 0) ||
      matchesKittySequence(data, CODEPOINTS.kpEnter, 0)
    );
  }
  return matchesEnterSequence(data, modifier);
}

function matchesBackspaceKey(data: string, modifier: number): boolean {
  if (modifier === MODIFIERS.alt && (data === "\x1b\x7f" || data === "\x1b\b")) {
    return true;
  }
  if (modifier === MODIFIERS.ctrl && matchesRawBackspace(data, MODIFIERS.ctrl)) {
    return true;
  }
  if (modifier === 0 && matchesRawBackspace(data, 0)) {
    return true;
  }
  return (
    matchesKittySequence(data, CODEPOINTS.backspace, modifier) ||
    matchesModifyOtherKeys(data, CODEPOINTS.backspace, modifier)
  );
}

const EDITING_CONTROL_MATCHERS: Record<string, (data: string, modifier: number) => boolean> = {
  backspace: matchesBackspaceKey,
  enter: matchesEnterKey,
  esc: matchesEscapeKey,
  escape: matchesEscapeKey,
  return: matchesEnterKey,
  space: matchesSpaceKey,
  tab: matchesTabKey,
};

function matchesEditingControlKey(
  request: keyControlMatchersTypes.KeyMatchRequest,
): boolean | undefined {
  return EDITING_CONTROL_MATCHERS[request.key]?.(request.data, request.modifier);
}

interface NavigationMatcher {
  readonly legacy: keySequencesTypes.LegacyModifierKey;
  readonly codepoint?: number;
}

const NAVIGATION_MATCHERS: Record<string, NavigationMatcher> = {
  clear: { legacy: "clear" },
  delete: { codepoint: FUNCTIONAL_CODEPOINTS.delete, legacy: "delete" },
  end: { codepoint: FUNCTIONAL_CODEPOINTS.end, legacy: "end" },
  home: { codepoint: FUNCTIONAL_CODEPOINTS.home, legacy: "home" },
  insert: { codepoint: FUNCTIONAL_CODEPOINTS.insert, legacy: "insert" },
  pagedown: { codepoint: FUNCTIONAL_CODEPOINTS.pageDown, legacy: "pageDown" },
  pageup: { codepoint: FUNCTIONAL_CODEPOINTS.pageUp, legacy: "pageUp" },
};

const matchesNavigationCodepoint = (
  data: string,
  codepoint: number | undefined,
  modifier: number,
): boolean => codepoint !== undefined && matchesKittySequence(data, codepoint, modifier);

function matchesNavigationKey(
  request: keyControlMatchersTypes.KeyMatchRequest,
): boolean | undefined {
  const { data, modifier } = request;
  const navigation = NAVIGATION_MATCHERS[request.key];
  if (navigation === undefined) return undefined;
  if (modifier === 0) {
    return (
      matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[navigation.legacy]) ||
      matchesNavigationCodepoint(data, navigation.codepoint, 0)
    );
  }
  return (
    matchesLegacyModifierSequence(data, navigation.legacy, modifier) ||
    matchesNavigationCodepoint(data, navigation.codepoint, modifier)
  );
}

const keyControlMatchers = {
  matchesEditingControlKey,
  matchesNavigationKey,
};

export default keyControlMatchers;
