import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it, vi } from "vite-plus/test";

import type * as delta from "../src/delta/index.ts";
import { type Ctx, createHost, hostNamed, memoryLinkPair, method, remote } from "../src/index.ts";
import { CountingLink, stateFrames } from "./fixtures/counting.ts";

const counts = vi.hoisted(() => ({ encoders: 0, encodes: 0 }));

vi.mock("../src/delta/index.ts", (importOriginal) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const original = yield* Effect.promise(() => importOriginal<typeof delta>());
      return {
        ...original,
        encoder: () => {
          counts.encoders++;
          const inner = original.encoder();
          return {
            encode: (ops: Parameters<typeof inner.encode>[0]) => {
              counts.encodes++;
              return inner.encode(ops);
            },
          };
        },
      };
    }),
  ),
);

const List = remote("t.e8-cost", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: {
    main: { state: { items: Type.Array(Type.String()) }, methods: { add: method(Type.String()) } },
  },
});

const oneChangeToKClientsK = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(List, (_input, _principal, self) => {
    const items = self.state("items", Type.Array(Type.String()), []);
    return {
      variant: "main",
      items,
      add: (text: string, ctx: Ctx) => {
        items.change(ctx, (draft) => {
          draft.push(text);
        });
      },
    };
  });
  const K = 4;
  const clients = Array.from({ length: K }, (_, i) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, { principal: { user: "u" } });
    const link = new CountingLink(up);
    const host = createHost({
      self: { kind: "host" },
      name: `browser${i}`,
      kind: "client",
      upstream: { link, principal: { kind: "server" } },
      onError: () => {},
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
