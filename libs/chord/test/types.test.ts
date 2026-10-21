import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";

const { hostNamed, local, method, remote } = chord;

const Doc = remote("t.e8-types-doc", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: {
    editor: { methods: { edit: method(Type.String()) }, state: { text: Type.String() } },
    reader: { state: { text: Type.String() } },
  },
  version: 1,
});
const Single = remote("t.e8-types-single", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: { methods: { bump: method() }, state: { n: Type.Number() } } },
  version: 1,
});
const Local = local("t.e8-types-local", {
  input: Type.Object({}),
  members: { n: Type.Number() },
  version: 1,
});

const stateMembersAreTOtherVariants = (): void => {
  const check = (host: chordTypes.Host, ctx: chordTypes.Ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const doc = yield* Effect.promise(() => host.get(Doc, {}));
        expectTypeOf(doc.text).toEqualTypeOf<chordTypes.Readable<string>>();
        expectTypeOf(doc).not.toHaveProperty("edit");
        if (doc.variant === "editor") expectTypeOf(doc.edit).toBeFunction();
        const single = yield* Effect.promise(() => ctx.get(Single, {}));
        expectTypeOf(single.n.value).toEqualTypeOf<number>();
        expectTypeOf(single.bump).toBeFunction();
        const held = host.hold(Local, {});
        expectTypeOf(held.n).toEqualTypeOf<chordTypes.Readable<number>>();
        expectTypeOf(host.get(Single, {})).toEqualTypeOf<Promise<chordTypes.Ref<typeof Single>>>();
      }),
    );
  expectTypeOf(check).toBeFunction();
};

describe("reference types", () => {
  it(
    "state members are T; other variants' members need narrowing; gets are awaited",
    stateMembersAreTOtherVariants,
  );
});
