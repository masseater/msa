import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, it } from "vite-plus/test";

import { createHost, hostNamed, method, remote } from "../src/index.ts";
import { fits } from "../src/schema.ts";

const case11FitsHasNoFalsePositives = (): void => {
  const cases = [
    [Type.String(), Type.String({ not: { const: "x" } }), "x"],
    [Type.Array(Type.Number()), Type.Array(Type.Number(), { contains: Type.Literal(1) }), [2]],
    [
      Type.Object({ a: Type.String() }),
      Type.Object({ a: Type.String() }, { additionalProperties: Type.Number() }),
      { a: "s", b: "t" },
    ],
    [
      Type.Object({ x: Type.String() }),
      Type.Object({}, { patternProperties: { "^x$": Type.Number() } }),
      { x: "s" },
    ],
    [Type.Number(), Type.Intersect([Type.Number(), Type.Number({ minimum: 1 })]), 0],
    [
      Type.Object({ a: Type.String() }, { additionalProperties: Type.Number() }),
      Type.Object({ a: Type.String(), b: Type.Optional(Type.String()) }),
      { a: "", b: 1 },
    ],
  ] as const;
  for (const [sub, sup, value] of cases) {
    assert.ok(
      Value.Check(sub, value) && !Value.Check(sup, value),
      `bad counterexample ${JSON.stringify(value)}`,
    );
    assert.equal(fits(sub, sup), false, `fits(${JSON.stringify(sub)}, ${JSON.stringify(sup)})`);
  }
  assert.ok(
    fits(
      Type.Object({ a: Type.String() }),
      Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) }),
    ),
  );
  assert.ok(
    fits(
      Type.Object({ a: Type.String(), extra: Type.Number() }),
      Type.Object({ a: Type.String() }),
    ),
  );
};

const case11ArgumentsAreStrippedToWhat = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Strict = remote("t.strict", {
    host: hostNamed("host"),
    input: Type.Object({}),
    variants: {
      main: {
        methods: {
          echo: method(
            Type.Object({ a: Type.String() }, { additionalProperties: false }),
            Type.Unknown(),
          ),
        },
      },
    },
    version: 1,
  });
  host.serve(Strict, () => ({ echo: (args) => args, variant: "main" }));
  const ref = host.hold(Strict, {});
  assert.deepEqual(yield* Effect.promise(() => ref.echo({ a: "x", junk: 1 } as never)), {
    a: "x",
  });
});

describe("review: contract fitting", () => {
  it(
    "#11 fits has no false positives for unmodelled keywords; counterexamples checked with Value.Check",
    case11FitsHasNoFalsePositives,
  );

  it("#11 arguments are stripped to what the consumer knows, then to what the provider knows", () =>
    Effect.runPromise(case11ArgumentsAreStrippedToWhat));
});
