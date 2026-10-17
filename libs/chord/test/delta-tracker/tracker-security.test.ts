import { describe, expect, it } from "vite-plus/test";

import { type JsonValue, track } from "../../src/delta/index.ts";
import { replay, settle } from "../fixtures/tracker.ts";

const definesOwnPropertiesWithoutInvokingInherited = (): void => {
  const tracker = track({} as Record<string, JsonValue>);
  Object.defineProperty(Object.getPrototypeOf({}), "trap", {
    get() {
      return undefined;
    },
    set() {
      throw new Error("inherited setter ran");
    },
    configurable: true,
  });
  try {
    settle(tracker, (draft) => {
      draft["trap"] = 1;
    });
    expect(tracker.value).toEqual({ trap: 1 });
  } finally {
    delete (Object.prototype as Record<string, unknown>)["trap"];
  }
};

const handlesReservedOwnKeysWithoutPrototype = (): void => {
  const initial = JSON.parse('{"safe":{"__proto__":{"value":1}}}') as {
    safe: { __proto__: { value: number } };
  };
  const tracker = track(initial);
  const change = tracker.beginChange();
  change.state.safe.__proto__.value = 2;
  const prepared = change.prepare();
  expect(prepared.value.safe.__proto__.value).toBe(2);
  expect(replay(tracker.value, prepared.ops)).toEqual(prepared.value);
  tracker.adopt(prepared);
  expect(({} as Record<string, unknown>)["value"]).toBeUndefined();
};

const supportsAMemorystorageStyleRecursiveClone = (): void => {
  const storageClone = <T>(value: T): T => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(storageClone) as T;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value))
      Object.defineProperty(output, key, {
        value: storageClone((value as Record<string, unknown>)[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    return output as T;
  };
  const tracker = track({ rows: [{ value: 1 }] });
  const change = tracker.beginChange();
  change.state.rows[0]!.value = 2;
  change.state.rows.push({ value: 3 });
  const prepared = change.prepare();
  expect(storageClone(prepared.value)).toEqual({ rows: [{ value: 2 }, { value: 3 }] });
  tracker.adopt(prepared);
};

describe("delta tracker security and storage-style cloning", () => {
  it(
    "defines own properties without invoking inherited setters",
    definesOwnPropertiesWithoutInvokingInherited,
  );

  it(
    "handles reserved own keys without prototype pollution",
    handlesReservedOwnKeysWithoutPrototype,
  );

  it(
    "supports a MemoryStorage-style recursive clone of Prepared.value",
    supportsAMemorystorageStyleRecursiveClone,
  );
});
