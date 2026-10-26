import assert from "node:assert";
import { it } from "node:test";

import tui from "../src/index.ts";

class Base {}

const attempts: Readonly<Record<string, () => unknown>> = {
  arrayElement: () => {
    const list = [tui];
    (list[0] as { Container: unknown }).Container = Base;
  },
  assign: () => Object.assign({ t: tui }.t, { Container: Base }),
  defineProperty: () => Object.defineProperty(tui, "Container", { value: Base }),
  forEach: () =>
    [tui].forEach((target) => {
      (target as { Container: unknown }).Container = Base;
    }),
  functionArgument: () => {
    const put = (target: { Container: unknown }) => {
      target.Container = Base;
    };
    put(tui as never);
  },
  mapValue: () => {
    (new Map([["t", tui]]).get("t") as { Container: unknown }).Container = Base;
  },
  objectProperty: () => {
    const box = { t: tui };
    (box.t as { Container: unknown }).Container = Base;
  },
  passthrough: () => {
    const passthrough = <T>(value: T): T => value;
    (passthrough(tui) as { Container: unknown }).Container = Base;
  },
  reflectSet: () => Reflect.set(tui, "Container", Base),
};

it("rejects every #224 write to the frozen @msa/tui export and keeps tui.Container", () => {
  const original = tui.Container;
  const outcomes = Object.fromEntries(
    Object.entries(attempts).map(([name, attempt]) => {
      try {
        const result = attempt();
        return [name, result === false ? "refused" : "succeeded"];
      } catch (error) {
        return [name, error instanceof TypeError ? "threw" : "other"];
      }
    }),
  );
  assert.deepStrictEqual(
    {
      containerUnchanged: tui.Container === original,
      descriptor: Object.getOwnPropertyDescriptor(tui, "Container"),
      frozen: Object.isFrozen(tui),
      outcomes,
    },
    {
      containerUnchanged: true,
      descriptor: { configurable: false, enumerable: true, value: original, writable: false },
      frozen: true,
      outcomes: {
        arrayElement: "threw",
        assign: "threw",
        defineProperty: "threw",
        forEach: "threw",
        functionArgument: "threw",
        mapValue: "threw",
        objectProperty: "threw",
        passthrough: "threw",
        reflectSet: "refused",
      },
    },
  );
});
