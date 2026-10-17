import { isProxy } from "node:util/types";

import { describe, expect, it } from "vite-plus/test";

import { type Draft, track } from "../../src/delta/index.ts";
import { clone, expectAliasFree, replay, settle } from "../fixtures/tracker.ts";

const handlesNullSparseOverridesWithoutConfusing = (): void => {
  const tracker = track({
    values: Array.from({ length: 10_000 }, (_, value): number | null => value),
  });
  settle(tracker, (draft) => {
    draft.values[17] = null;
    draft.values[9_000] = null;
  });
  expect(tracker.value.values[17]).toBeNull();
  expect(tracker.value.values[9_000]).toBeNull();
};

const supportsSelfOverlappingFillAndCopywithin = (): void => {
  const tracker = track({ values: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }] });
  settle(tracker, (draft) => {
    draft.values.copyWithin(1, 0, 3);
    draft.values.fill(draft.values[1]!, 0, 2);
    draft.values[0]!.n = 9;
  });
  expect(tracker.value.values.map((value) => value.n)).toEqual([9, 0, 1, 2]);
  expect(tracker.value.values[0]).not.toBe(tracker.value.values[1]);
};

describe("delta tracker piece arrays", () => {
  it(
    "handles null sparse overrides without confusing absence",
    handlesNullSparseOverridesWithoutConfusing,
  );

  it(
    "supports self-overlapping fill and copyWithin by value",
    supportsSelfOverlappingFillAndCopywithin,
  );

  it.each(["unshift", "splice"] as const)(
    "inserts 100,000 items with %s",
    (method) => {
      const tracker = track({ values: [-1] });
      const base = clone(tracker.value);
      const change = tracker.beginChange();
      const items = Array.from({ length: 100_000 }, (_, value) => value);
      if (method === "unshift")
        Reflect.apply(change.state.values.unshift, change.state.values, items);
      else Reflect.apply(change.state.values.splice, change.state.values, [1, 0, ...items]);
      const prepared = change.prepare();
      expect(prepared.value.values).toHaveLength(100_001);
      expect(prepared.value.values[method === "unshift" ? 99_999 : 100_000]).toBe(99_999);
      expect(replay(base, prepared.ops)).toEqual(prepared.value);
      tracker.adopt(prepared);
    },
    30_000,
  );
});

type Document = {
  values: { id: number; score: number }[];
  text: string;
  meta: { revision: number; label?: string };
};
const random =
  (seed: number): (() => number) =>
  () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
const mutate = (document: Document | Draft<Document>, choice: number, value: number): void => {
  const item = (): { id: number; score: number } => ({ id: value, score: value % 7 });
  switch (choice) {
    case 0:
      document.text += `-${value}`;
      break;
    case 1:
      document.values.push(item());
      break;
    case 2:
      document.values.unshift(item());
      break;
    case 3:
      if (document.values.length > 0) document.values.shift();
      break;
    case 4:
      if (document.values.length > 0) document.values.pop();
      break;
    case 5: {
      const index = document.values.length === 0 ? 0 : value % (document.values.length + 1);
      document.values.splice(index, document.values.length === 0 ? 0 : value % 2, item());
      break;
    }
    case 6:
      document.values.reverse();
      break;
    case 7:
      document.values.sort((left, right) => left.id - right.id);
      break;
    case 8:
      if (document.values.length > 0)
        document.values[value % document.values.length]!.score = value;
      break;
    case 9:
      document.meta.revision++;
      document.meta.label = `r-${value}`;
      break;
    default:
      delete document.meta.label;
  }
};

describe("delta tracker randomized transactions", () => {
  it("matches policy, detached replay, and adopted state after multi-operation transactions", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = random(seed);
      const initial: Document = {
        values: Array.from({ length: 4 }, (_, id) => ({ id, score: 0 })),
        text: "start",
        meta: { revision: 0 },
      };
      const tracker = track(initial);
      const expected = clone(initial);
      for (let transaction = 0; transaction < 25; transaction++) {
        const baseRoot = tracker.value;
        const base = clone(baseRoot);
        const change = tracker.beginChange();
        for (let operation = 0; operation < 5; operation++) {
          const choice = Math.floor(rng() * 11);
          const value = seed * 10_000 + transaction * 10 + operation;
          mutate(expected, choice, value);
          mutate(change.state, choice, value);
        }
        const prepared = change.prepare();
        const policy = clone(prepared.value);
        expect(isProxy(prepared.value)).toBe(false);
        expect(baseRoot, `prepare changed base seed ${seed} transaction ${transaction}`).toEqual(
          base,
        );
        expect(policy, `policy seed ${seed} transaction ${transaction}`).toEqual(expected);
        expect(
          replay(base, prepared.ops),
          `replay seed ${seed} transaction ${transaction}`,
        ).toEqual(policy);
        tracker.adopt(prepared);
        expect(baseRoot, `adopt changed base seed ${seed} transaction ${transaction}`).toEqual(
          base,
        );
        expect(tracker.value, `adopt seed ${seed} transaction ${transaction}`).toBe(prepared.value);
        expect(tracker.value, `adopt seed ${seed} transaction ${transaction}`).toEqual(policy);
        expectAliasFree(tracker.value);
      }
    }
  }, 30_000);
});

const ordersManyReverseDepthObjectEdits = (): void => {
  type DeepNode = { value: number; next?: DeepNode };
  let initial: DeepNode = { value: 0 };
  for (let depth = 0; depth < 512; depth++) initial = { value: 0, next: initial };
  const tracker = track(initial);
  const change = tracker.beginChange();
  const nodes: Array<Draft<DeepNode>> = [];
  let node: Draft<DeepNode> | undefined = change.state;
  while (node !== undefined) {
    nodes.push(node);
    node = node.next;
  }
  for (let index = nodes.length - 1; index >= 0; index--) nodes[index]!.value = index + 1;
  const prepared = change.prepare();
  expect(prepared.ops).toHaveLength(nodes.length);
  expect(replay(initial, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
  expectAliasFree(tracker.value);
};

describe("delta tracker object emission scaling", () => {
  it(
    "orders many reverse-depth object edits through the bounded fallback",
    ordersManyReverseDepthObjectEdits,
  );
});
