import { describe, expect, it, vi } from "vite-plus/test";

import contextModule from "../src/context/index.ts";
import type deltaTypes from "../src/delta/index.types.ts";
import chord from "../src/index.ts";

const { replicatedState } = chord;
const { BACKGROUND_CONTEXT } = contextModule;

const publishesOneImmutableStructurallySharedRevision = (): void => {
  const initial = { changed: { value: 1 }, retained: { value: 2 } };
  const state = replicatedState(initial);
  const previous = state.value;
  const deliveries: number[] = [];
  state.subscribe((_value, _context, delivery) => deliveries.push(delivery.sequence));
  state.change(BACKGROUND_CONTEXT, (draft) => {
    draft.changed.value = 3;
    draft.changed.value = 4;
  });
  expect(state.value).toEqual({ changed: { value: 4 }, retained: { value: 2 } });
  expect(state.value).not.toBe(previous);
  expect(state.value.changed).not.toBe(previous.changed);
  expect(state.value.retained).toBe(previous.retained);
  expect(Object.isFrozen(state.value)).toBe(false);
  expect(deliveries).toEqual([0, 1]);
};

const rollsBackCallbackFailuresAndRevokes = (): void => {
  const state = replicatedState({ nested: { value: 1 } });
  const previous = state.value;
  let escaped: deltaTypes.Draft<{ value: number }> | undefined;
  expect(() =>
    state.change(BACKGROUND_CONTEXT, (draft) => {
      escaped = draft.nested;
      draft.nested.value = 2;
      throw new Error("stop");
    }),
  ).toThrow("stop");
  expect(state.value).toBe(previous);
  expect(() => escaped?.value).toThrow(TypeError);
};

const rejectsPromiselikeCallbacksAndAbortsTheir = (): void => {
  const state = replicatedState({ value: 0 });
  const previous = state.value;
  expect(() =>
    state.change(BACKGROUND_CONTEXT, ((draft: deltaTypes.Draft<{ value: number }>) => {
      draft.value = 1;
      return Promise.resolve();
    }) as (draft: deltaTypes.Draft<{ value: number }>) => void),
  ).toThrow(/synchronous/u);
  expect(state.value).toBe(previous);
};

const rejectsNestedChangesAndReplacementsWithout = (): void => {
  const state = replicatedState({ left: 0, right: 0 });
  expect(() =>
    state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.left = 1;
      state.change(BACKGROUND_CONTEXT, (nested) => {
        nested.right = 2;
      });
    }),
  ).toThrow(/reentrantly/u);
  expect(state.value).toEqual({ left: 0, right: 0 });
  expect(() =>
    state.change(BACKGROUND_CONTEXT, () => {
      state.replace(BACKGROUND_CONTEXT, { left: 1, right: 2 });
    }),
  ).toThrow(/change callback/u);
  expect(state.value).toEqual({ left: 0, right: 0 });
};

const queuesListenerTriggeredChangesInSequence = (): void => {
  const state = replicatedState({ value: 0 });
  const deliveries: Array<{ value: number; sequence: number }> = [];
  const lateDeliveries: Array<{ kind: string; sequence: number }> = [];
  let nested = false;
  state.subscribe((_value, _context, delivery) => {
    if (delivery.kind !== "update" || nested) return;
    nested = true;
    state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.value = 2;
    });
    state.subscribe((_lateValue, _lateContext, lateDelivery) => lateDeliveries.push(lateDelivery));
  });
  state.subscribe((value, _context, delivery) => {
    if (delivery.kind === "update")
      deliveries.push({ sequence: delivery.sequence, value: value.value });
  });
  state.change(BACKGROUND_CONTEXT, (draft) => {
    draft.value = 1;
  });
  expect(deliveries).toEqual([
    { sequence: 1, value: 1 },
    { sequence: 2, value: 2 },
  ]);
  expect(lateDeliveries).toEqual([{ kind: "hydrate", sequence: 2 }]);
};

const isolatesListenerFailuresAfterCommittingThe = (): void => {
  const reports: (() => void)[] = [];
  const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((report) => {
    reports.push(report);
  });
  try {
    const state = replicatedState({ value: 0 });
    const received: number[] = [];
    state.subscribe((_value, _context, delivery) => {
      if (delivery.kind === "update") throw new Error("listener failed");
    });
    state.subscribe((_value, _context, delivery) => received.push(delivery.sequence));
    expect(() =>
      state.change(BACKGROUND_CONTEXT, (draft) => {
        draft.value = 1;
      }),
    ).not.toThrow();
    expect(state.value).toEqual({ value: 1 });
    expect(received).toEqual([0, 1]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toThrow("listener failed");
  } finally {
    spy.mockRestore();
  }
};

const copiesAssignedValuesByValue = (): void => {
  const external = { value: 1 };
  const state = replicatedState<{
    left: { value: number } | null;
    right: { value: number } | null;
  }>({
    left: null,
    right: null,
  });
  state.change(BACKGROUND_CONTEXT, (draft) => {
    draft.left = external;
    draft.right = external;
    draft.left.value = 2;
  });
  expect(external.value).toBe(1);
  expect(state.value).toEqual({ left: { value: 2 }, right: { value: 1 } });
  expect(state.value.left).not.toBe(state.value.right);
};

const takesImmutableOwnershipOfAliasFree = (): void => {
  const state = replicatedState({ left: { value: 1 }, right: { value: 2 } });
  const replacement = { left: { ...state.value.left }, right: { ...state.value.left } };
  state.replace(BACKGROUND_CONTEXT, replacement);
  expect(state.value).toBe(replacement);
  expect(state.value.left).not.toBe(state.value.right);
  state.change(BACKGROUND_CONTEXT, (draft) => {
    draft.left.value = 9;
  });
  expect(state.value).toEqual({ left: { value: 9 }, right: { value: 1 } });
};

const replacesAtomicallyAndIgnoresDeeplyEqual = (): void => {
  const state = replicatedState({ retained: { nested: 2 }, value: { nested: 1 } });
  const previous = state.value;
  state.replace(BACKGROUND_CONTEXT, { retained: { nested: 2 }, value: { nested: 1 } });
  expect(state.value).toBe(previous);
  state.replace(BACKGROUND_CONTEXT, { ...state.value, value: { nested: 2 } });
  expect(state.value).toEqual({ retained: { nested: 2 }, value: { nested: 2 } });
  expect(state.value.retained).toBe(previous.retained);
};

describe("transactional replicated state", () => {
  it(
    "publishes one immutable structurally shared revision",
    publishesOneImmutableStructurallySharedRevision,
  );

  it(
    "rolls back callback failures and revokes escaped drafts",
    rollsBackCallbackFailuresAndRevokes,
  );

  it(
    "rejects PromiseLike callbacks and aborts their draft",
    rejectsPromiselikeCallbacksAndAbortsTheir,
  );

  it(
    "rejects nested changes and replacements without losing the outer rollback",
    rejectsNestedChangesAndReplacementsWithout,
  );

  it(
    "queues listener-triggered changes in sequence order",
    queuesListenerTriggeredChangesInSequence,
  );

  it(
    "isolates listener failures after committing the revision",
    isolatesListenerFailuresAfterCommittingThe,
  );

  it("copies assigned values by value", copiesAssignedValuesByValue);

  it("takes immutable ownership of alias-free replacements", takesImmutableOwnershipOfAliasFree);

  it(
    "replaces atomically and ignores deeply equal replacements",
    replacesAtomicallyAndIgnoresDeeplyEqual,
  );
});
