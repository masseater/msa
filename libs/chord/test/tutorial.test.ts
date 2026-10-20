import assert from "node:assert/strict";

import { Effect } from "effect";
import { expectTypeOf, it, onTestFinished } from "vite-plus/test";

import { createHost, isChordError, memoryLinkPair } from "../src/index.ts";
import tutorial from "./fixtures/tutorial.ts";
import type tutorialTypes from "./fixtures/tutorial.types.ts";

const { Database, SavedTodos, TodoLabel, TodoStore, Todos, serveViews, todoStore } = tutorial;

type Principal = tutorialTypes.Principal;

const todoFactory = todoStore();

const objectsLiveInsideHosts = Effect.gen(function* () {
  const host = createHost({ name: "todo-server", self: "server" });
  assert.equal(host.name, "todo-server");
  yield* Effect.promise(() => host.close());
});

const firstObject = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost({ self: "server" });
  host.serve(TodoLabel, ({ list }) => ({ label: () => `Todos for ${list}` }));
  const result = yield* Effect.promise(() =>
    host.root((ctx) => ctx.get(TodoLabel, { list: "family" }).then((todos) => todos.label(ctx))),
  );
  assert.equal(result, "Todos for family");
});

const liveState = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost({ dev: true, self: "server" });
  host.serve(TodoStore, todoFactory);
  const todos = yield* Effect.promise(() => host.get(TodoStore, { list: "family" }));
  const counts: (number | undefined)[] = [];
  const stop = todos.openCount.subscribe((value) => counts.push(value));
  yield* Effect.promise(() =>
    host.root((ctx) =>
      todos
        .add({ text: "Buy milk" }, ctx)
        .then(() => todos.finish({ index: 0 }, ctx))
        .then(() => todos.reset([], ctx)),
    ),
  );
  assert.deepEqual(counts, [0, 1, 0]);
  assert.deepEqual(todos.rows.value, []);
  stop();
  todos.release();
});

const objectsUseObjects = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost({ self: "server" });
  let opens = 0;
  const closed = Promise.withResolvers<void>();
  host.serve(Database, (_input, _principal, self) => {
    const db = self.resource("db", {
      close: () => closed.resolve(),
      open: () => {
        opens++;
        return { saved: [] as string[] };
      },
      version: 1,
    });
    return { db: self.expose(db) };
  });
  host.serve(TodoStore, todoFactory);
  host.serve(
    SavedTodos,
    ({ list }, _principal, self) => {
      const database = self.get(Database, {});
      const todos = self.get(TodoStore, { list });
      return {
        add: ({ text }, ctx) => {
          database.db!.saved.push(text);
          return todos.add({ text }, ctx);
        },
      };
    },
    { linger: 0 },
  );
  const saved = yield* Effect.promise(() => host.get(SavedTodos, { list: "family" }));
  const database = yield* Effect.promise(() => host.get(Database, {}));
  yield* Effect.promise(() => host.root((ctx) => saved.add({ text: "Buy milk" }, ctx)));
  assert.deepEqual(database.db!.saved, ["Buy milk"]);
  assert.equal(opens, 1);
  const statuses: string[] = [];
  saved.onStatus((status) => statuses.push(status));
  database.release();
  saved.release();
  yield* Effect.promise(() => closed.promise);
  assert.equal(saved.status, "released");
  assert.ok(statuses.includes("released"));
});

const principalViews = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost<Principal>({
    name: "server",
    principalKey: (principal) => principal,
    self: "server",
  });
  host.serve(TodoStore, todoFactory);
  serveViews(host);
  const owner = yield* Effect.promise(() =>
    host.get(Todos, { list: "family" }, { principal: "owner" }),
  );
  const guest = yield* Effect.promise(() =>
    host.get(Todos, { list: "family" }, { principal: "guest" }),
  );
  assert.ok(owner.variant === "editor");
  assert.equal(guest.variant, "viewer");
  yield* Effect.promise(() =>
    host.root((ctx) => owner.add({ text: "Buy milk" }, ctx), { principal: "owner" }),
  );
  assert.deepEqual(guest.rows.value, [{ done: false, text: "Buy milk" }]);
  expectTypeOf(guest).not.toHaveProperty("add");
  yield* Effect.promise(() =>
    assert.rejects(
      Reflect.apply(Reflect.get(guest, "add"), guest, [{ text: "Not allowed" }]),
      (error) => isChordError(error, "not_in_variant"),
    ),
  );
  yield* Effect.promise(() =>
    assert.rejects(owner.add({ text: " " }), (error) => isChordError(error, "invalid")),
  );
});

const overAMemoryLink = Effect.gen(function* () {
  onTestFinished(() => server.close());
  onTestFinished(() => browser.close());
  const server = createHost<Principal>({ name: "server", self: "server" });
  server.serve(TodoStore, todoFactory);
  serveViews(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "client", principal: "owner" });
  const browser = createHost({
    kind: "client",
    name: "browser",
    self: "browser",
    upstream: { link: up, principal: "server" },
  });
  const todos = yield* Effect.promise(() => browser.get(Todos, { list: "family" }));
  assert.ok(todos.variant === "editor");
  assert.deepEqual(todos.rows.value, []);
  const updated = Promise.withResolvers<void>();
  const stop = todos.rows.subscribe((rows) => {
    if (rows.length === 1) updated.resolve();
  });
  yield* Effect.promise(() => browser.root((ctx) => todos.add({ text: "Buy milk" }, ctx)));
  yield* Effect.promise(() => updated.promise);
  assert.deepEqual(todos.rows.value, [{ done: false, text: "Buy milk" }]);
  yield* Effect.promise(() =>
    assert.rejects(todos.add({ text: 123 } as never), (error) => isChordError(error, "invalid")),
  );
  stop();
  assert.deepEqual(todos.rows.value, [{ done: false, text: "Buy milk" }]);
  todos.release();
});

it("01: objects live inside hosts", { timeout: 5000 }, () =>
  Effect.runPromise(objectsLiveInsideHosts),
);

it("02: first contract, factory, reference and root", { timeout: 5000 }, () =>
  Effect.runPromise(firstObject),
);

it("03: cells publish values and derivations", { timeout: 5000 }, () =>
  Effect.runPromise(liveState),
);

it("04: holds, asynchronous resources and release", { timeout: 5000 }, () =>
  Effect.runPromise(objectsUseObjects),
);

it("05: principals select views of one shared store", { timeout: 5000 }, () =>
  Effect.runPromise(principalViews),
);

it("06: remote methods and live state over a memory link", { timeout: 5000 }, () =>
  Effect.runPromise(overAMemoryLink),
);
