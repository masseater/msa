import { Function as Fn } from "effect";

import storeTypes from "./store-types.ts";

const { RRF_K } = storeTypes;

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike === true) words.push(segment.segment);
  }
  return words;
}

function phrase(word: string): string {
  return `"${word.replaceAll('"', '""')}"`;
}

const cosineSimilarityImpl = (a: Float32Array, b: Float32Array): number => {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!;
    const right = b[index]!;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const cosineSimilarity: {
  (b: Float32Array): (a: Float32Array) => number;
  (a: Float32Array, b: Float32Array): number;
} = Fn.dual(2, cosineSimilarityImpl);

const reciprocalRankFusionImpl = (
  rankings: readonly (readonly string[])[],
  k = RRF_K,
): Map<string, number> => {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return fused;
};

const reciprocalRankFusion: {
  (k?: number): (rankings: readonly (readonly string[])[]) => Map<string, number>;
  (rankings: readonly (readonly string[])[], k?: number): Map<string, number>;
} = Fn.dual((args) => Array.isArray(args[0]), reciprocalRankFusionImpl);

function encodeVector(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(0), vector.byteOffset, vector.byteLength);
}

function decodeVector(bytes: Uint8Array): Float32Array {
  const copy = bytes.slice();
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

const storeVectors = {
  cosineSimilarity,
  decodeVector,
  encodeVector,
  phrase,
  reciprocalRankFusion,
  segmentWords,
};

export default storeVectors;
