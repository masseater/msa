import type keySequences from "./key-sequences.ts";

declare namespace keySequencesTypes {
  type LegacyModifierKey = keyof typeof keySequences.LEGACY_SHIFT_SEQUENCES;
}

export type { keySequencesTypes as default };
