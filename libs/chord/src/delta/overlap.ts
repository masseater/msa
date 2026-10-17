import { dual } from "effect/Function";

function overlapOf(a: string, b: string, scan: number, probe = 64, maxCandidates = 8): number {
  if (a.length === 0 || b.length === 0 || scan === 0) return 0;
  const tail = a.length > scan ? a.slice(a.length - scan) : a;

  for (const h of [Math.min(probe, b.length), 1]) {
    const head = b.slice(0, h);
    let tried = 0;
    for (let k = tail.indexOf(head); k !== -1; k = tail.indexOf(head, k + 1)) {
      if (++tried > maxCandidates) break;
      const n = tail.length - k;
      if (n <= b.length && tail.slice(k) === b.slice(0, n)) return n;
    }
    if (h === 1) break;
  }
  return 0;
}

export const overlap: {
  (b: string, scan: number, probe?: number, maxCandidates?: number): (a: string) => number;
  (a: string, b: string, scan: number, probe?: number, maxCandidates?: number): number;
} = dual((args) => args.length >= 3, overlapOf);
