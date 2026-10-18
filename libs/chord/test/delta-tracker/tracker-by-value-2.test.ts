import { isProxy } from "node:util/types";

import { describe, expect, it } from "vite-plus/test";

import { track } from "../../src/delta/index.ts";
import { clone, replay } from "../fixtures/tracker.ts";

const foldsPathologicalOperationCountsWithoutPayload = (): void => {
  const wide = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [`field${index}`, 0]),
  ) as Record<string, number>;
  const wideTracker = track(wide);
  const wideBase = clone(wideTracker.value);
  const wideChange = wideTracker.beginChange();
  for (let index = 0; index < 5_000; index++) wideChange.state[`field${index}`] = 1;
  const widePrepared = wideChange.prepare();
  expect(widePrepared.ops).toHaveLength(1);
  expect(widePrepared.ops[0]?.[0]).toBe("r");
  expect(replay(wideBase, widePrepared.ops)).toEqual(widePrepared.value);
  wideTracker.adopt(widePrepared);

  const sparseTracker = track({
    rows: Array.from({ length: 15_000 }, (_, value) => ({ value })),
  });
  const sparseBase = clone(sparseTracker.value);
  const sparseChange = sparseTracker.beginChange();
  for (let index = 0; index < 15_000; index += 3)
    sparseChange.state.rows[index]!.value = -index - 1;
  const sparsePrepared = sparseChange.prepare();
  expect(sparsePrepared.ops).toHaveLength(1);
  expect(sparsePrepared.ops[0]?.[0]).toBe("r");
  expect(replay(sparseBase, sparsePrepared.ops)).toEqual(sparsePrepared.value);
  sparseTracker.adopt(sparsePrepared);
};

const sharesImmutableOperationPlacementsWithThe = (): void => {
  const tracker = track({ rows: [] as { value: number }[] });
  const change = tracker.beginChange();
  change.state.rows.push({ value: 1 });
  const prepared = change.prepare();
  const operations = prepared.ops;
  const pending: unknown[] = [...operations];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    expect(isProxy(value)).toBe(false);
    pending.push(...Object.values(value));
  }
  const splice = operations[0];
  if (splice?.[0] !== "p") throw new Error("expected splice");
  expect(splice[4][0]).toBe(prepared.value.rows[0]);
  tracker.adopt(prepared);
  expect(tracker.value).toBe(prepared.value);
};

describe("delta tracker by-value placements", () => {
  it(
    "folds pathological operation counts without payload-cost estimation",
    foldsPathologicalOperationCountsWithoutPayload,
    30_000,
  );

  it(
    "shares immutable operation placements with the materialized candidate",
    sharesImmutableOperationPlacementsWithThe,
  );
});
