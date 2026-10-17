import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  type Ctx,
  type Host,
  hostNamed,
  local,
  method,
  type Readable,
  type Ref,
  remote,
} from "../src/index.ts";

const Doc = remote("t.e8-types-doc", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    reader: { state: { text: Type.String() } },
    editor: { state: { text: Type.String() }, methods: { edit: method(Type.String()) } },
  },
});
const Single = remote("t.e8-types-single", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { main: { state: { n: Type.Number() }, methods: { bump: method() } } },
});
const Local = local("t.e8-types-local", {
  version: 1,
  input: Type.Object({}),
  members: { n: Type.Number() },
});

describe("reference types", () => {
  it("state members are T; other variants' members need narrowing; gets are awaited", () => {
    const check = async (host: Host, ctx: Ctx) => {
      const doc = await host.get(Doc, {});
      expectTypeOf(doc.text).toEqualTypeOf<Readable<string>>();
      expectTypeOf(doc).not.toHaveProperty("edit");
      if (doc.variant === "editor") expectTypeOf(doc.edit).toBeFunction();
      const single = await ctx.get(Single, {});
      expectTypeOf(single.n.value).toEqualTypeOf<number>();
      expectTypeOf(single.bump).toBeFunction();
      const held = host.hold(Local, {});
      expectTypeOf(held.n).toEqualTypeOf<Readable<number>>();
      expectTypeOf(host.get(Single, {})).toEqualTypeOf<Promise<Ref<typeof Single>>>();
    };
    expectTypeOf(check).toBeFunction();
  });
});
