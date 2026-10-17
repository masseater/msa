import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  type Facet,
  hostNamed,
  isChordError,
  memoryLinkPair,
  method,
  type Readable,
  remote,
} from "../src/index.ts";
import { CountingLink, stateFrames } from "./fixtures/counting.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function until(check: () => boolean, attempts = 200): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (let i = 0; i < attempts && !check(); i++) yield* Effect.promise(() => sleep(2));
      assert.ok(check(), "condition not reached");
    }),
  );
}

const Doc = remote("t.e8-doc", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    a: { state: { x: Type.Number() }, methods: { bump: method() } },
    b: { state: { x: Type.Number(), y: Type.String() }, methods: { bump: method() } },
    c: { state: { y: Type.String() }, methods: { bump: method() } },
  },
});

function docFacet(variant: "a" | "b" | "c"): Facet {
  return {
    name: "doc",
    setup: (api) =>
      api.serve(Doc, (_input, _principal, self) => {
        const x = self.state("x", Type.Number(), 1);
        const y = self.state("y", Type.String(), "why");
        const bump = (ctx: Ctx) => {
          x.replace(ctx, x.value + 1);
        };
        if (variant === "a") return { variant, x, bump };
        if (variant === "b") return { variant, x, y, bump };
        return { variant, y, bump };
      }),
  };
}

type View = {
  readonly variant: string | undefined;
  readonly x: Readable<number>;
  readonly y: Readable<string>;
};
const view = (ref: object): View => ref as unknown as View;

function setup() {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  const link = new CountingLink(up);
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link, principal: { kind: "server" } },
    onError: () => {},
  });
  return { server, browser, link };
}

const aNewVariantSMembersArrive = Effect.gen(function* () {
  const { server, browser, link } = setup();
  yield* Effect.promise(() => server.install(docFacet("a")));
  const doc = browser.hold(Doc, {});
  yield* Effect.promise(() => doc.ready);
  assert.equal(view(doc).variant, "a");
  assert.equal(view(doc).x.value, 1);
  assert.throws(
    () => view(doc).y.value,
    (error) => isChordError(error, "not_in_variant"),
  );
  const failures: unknown[] = [];
  doc.onShape((shape) => {
    for (const name of ["x", "y"]) {
      const member = Doc.description.variants[shape.variant ?? ""]?.[name];
      if (member?.kind !== "state") continue;
      try {
        void (view(doc) as unknown as Record<string, Readable<unknown>>)[name]!.value;
      } catch (error) {
        failures.push(error);
      }
    }
  });
  const before = stateFrames(link.received).length;
  yield* Effect.promise(() => server.reload([docFacet("b")]));
  yield* Effect.promise(() => until(() => view(doc).variant === "b"));
  assert.equal(view(doc).y.value, "why");
  assert.equal(view(doc).x.value, 1);
  const unit = stateFrames(link.received).slice(before);
  assert.deepEqual(
    unit.filter((frame) => frame.as === "snap").map((frame) => frame.m),
    ["y"],
    "only the new member's snapshot",
  );
  yield* Effect.promise(() => server.reload([docFacet("c")]));
  yield* Effect.promise(() => until(() => view(doc).variant === "c"));
  assert.throws(
    () => view(doc).x.value,
    (error) => isChordError(error, "not_in_variant"),
  );
  assert.equal(view(doc).y.value, "why");
  assert.deepEqual(failures, []);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("variants", () => {
  it("a new variant's members arrive with its shape; a member outside the variant throws not_in_variant", () =>
    Effect.runPromise(aNewVariantSMembersArrive));
});

const keepsTheLastValuesReadableSends = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  yield* Effect.promise(() => server.install(docFacet("b")));
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const doc = browser.hold(Doc, {});
  yield* Effect.promise(() => doc.ready);
  yield* Effect.promise(() => doc.bump());
  yield* Effect.promise(() => until(() => view(doc).x.value === 2));
  up.close();
  yield* Effect.promise(() => until(() => doc.status === "loading"));
  assert.equal(view(doc).x.value, 2);
  const joining = browser.hold(Doc, {});
  assert.equal(joining.status, "loading");
  let joined = false;
  void joining.ready.then(() => {
    joined = true;
    return undefined;
  });
  yield* Effect.promise(() => sleep(5));
  assert.equal(joined, false, "a reference joining during the re-hold waits for the fresh unit");

  const [down2, up2] = memoryLinkPair();
  server.accept(down2, { principal: { user: "u" } });
  const link = new CountingLink(up2);
  browser.connect(link, { principal: { kind: "server" } });
  yield* Effect.promise(() => joining.ready);
  assert.equal(doc.status, "live");
  const hold = link.sent.find((frame) => frame.t === "hold");
  assert.ok(hold?.t === "hold" && hold.again === true, "a re-hold says again");
  assert.equal(link.count("sent", "hold"), 1, "one hold for both references");
  const snaps = stateFrames(link.received).filter((frame) => frame.as === "snap");
  assert.deepEqual(snaps.map((frame) => frame.m).sort(), ["x", "y"], "one snapshot per member");
  assert.equal(view(doc).x.value, 1);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("re-hold after a link loss", () => {
  it("keeps the last values readable, sends one fresh unit, and a reference joining meanwhile waits for it", () =>
    Effect.runPromise(keepsTheLastValuesReadableSends));
});
