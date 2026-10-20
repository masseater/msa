import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it, vi } from "vite-plus/test";

import type deltaModule from "../src/delta/index.ts";
import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import CountingLink from "./fixtures/counting-link.ts";
import counting from "./fixtures/counting.ts";

const { createHost, hostNamed, memoryLinkPair, method, remote } = chord;

const { stateFrames } = counting;

const counts = vi.hoisted(() => ({ encoders: 0, encodes: 0 }));

vi.mock("../src/delta/index.ts", (importOriginal) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const original = yield* Effect.promise(() =>
        importOriginal<{ readonly default: typeof deltaModule }>(),
      );
      const kit = original.default;
      return {
        ...original,
        default: {
          ...kit,
          encoder: () => {
            counts.encoders++;
            const inner = kit.encoder();
            return {
              encode: (ops: Parameters<typeof inner.encode>[0]) => {
                counts.encodes++;
                return inner.encode(ops);
              },
            };
          },
        },
      };
    }),
  ),
);

const List = remote("t.e8-cost", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: {
    main: { methods: { add: method(Type.String()) }, state: { items: Type.Array(Type.String()) } },
  },
  version: 1,
});

const oneChangeToKClientsK = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(List, (_input, _principal, self) => {
    const items = self.state("items", Type.Array(Type.String()), []);
    return {
      add: (text: string, ctx: chordTypes.Ctx) => {
        items.change(ctx, (draft) => {
          draft.push(text);
        });
      },
      items,
      variant: "main",
    };
  });
  const K = 4;
  const clients = Array.from({ length: K }, (_, i) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, { principal: { user: "u" } });
    const link = new CountingLink(up);
    const host = createHost({
      kind: "client",
      name: `browser${i}`,
      onError: () => {},
      self: { kind: "host" },
      upstream: { link, principal: { kind: "server" } },
    });
    return { host, link, ref: host.hold(List, {}) };
  });
  yield* Effect.promise(() => Promise.all(clients.map((client) => client.ref.ready)));
  const encoders = counts.encoders;
  const encodes = counts.encodes;
  const before = clients.map((client) => stateFrames(client.link.received).length);
  yield* Effect.promise(() => clients[0]!.ref.add("x"));
  yield* Effect.sleep(10);
  assert.equal(counts.encodes - encodes, K, "one encode per feed");
  assert.equal(counts.encoders, encoders, "no new streams for a change");
  const frames = clients.map((client, i) => stateFrames(client.link.received).slice(before[i]));
  for (const list of frames) assert.equal(list.length, 1);
  const ops = frames.map((list) => JSON.stringify(list[0]?.ops));
  assert.equal(new Set(ops).size, 1, "every link carries the same ops");
  for (const client of clients) assert.deepEqual(client.ref.items.value, ["x"]);
  yield* Effect.promise(() => server.close());
});

describe("provider cost", () => {
  it("one change to K clients: K encodes (one per feed), one frame per link, the same ops on every link", () =>
    Effect.runPromise(oneChangeToKClientsK));
});
