import type { Id, Seq } from "./types.ts";

/**
 * Apply an erased ID brand at a trusted numeric allocation or decoding boundary.
 * @param {number} value - The number.
 * @returns {I} The ID.
 */
export function idFromNumber<I extends Id<string>>(value: number): I {
  return value as I;
}

/**
 * Apply the erased commit-sequence brand at a trusted storage boundary.
 * @param {number} value - The number.
 * @returns {Seq} The sequence number.
 */
export function seqFromNumber(value: number): Seq {
  return value as Seq;
}
