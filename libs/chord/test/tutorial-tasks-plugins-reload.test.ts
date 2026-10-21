import assert from "node:assert/strict";

import { Effect } from "effect";
import { type Static, Type } from "typebox";
import { it, onTestFinished } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import tutorial from "./fixtures/tutorial.ts";
import type tutorialTypes from "./fixtures/tutorial.types.ts";

const { createHost, defineFacet, defineRegistry, isChordError, local, method } = chord;

const { Rows, TodoStore, Todos, serveViews, todoStore } = tutorial;

type Principal = tutorialTypes.Principal;

const todoFactory = todoStore();

const listenersAndTasks = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const Activity = local("tutorial.activity", {
    input: Type.Object({}),
    members: { seen: Type.Number() },
    version: 1,
  });
  const host = createHost({ self: "server" });
  host.serve(TodoStore, todoFactory);
  const observed = Promise.withResolvers<void>();
  const seeded = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  host.serve(Activity, (_input, _principal, self) => {
    const todos = self.get(TodoStore, { list: "family" });
    const seen = self.state("seen", Type.Number(), 0);
    self.on("rows", todos.rows, (rows, ctx) => {
      seen.replace(ctx, rows?.length ?? 0);
      if (rows?.length === 1) observed.resolve();
    });
    self.task((ctx) =>
      todos.add({ text: "Review the list" }, ctx).then(() => {
        seeded.resolve();
        const aborted = Promise.withResolvers<void>();
        if (ctx.signal.aborted) aborted.resolve();
        else ctx.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        return aborted.promise.then(() => stopped.resolve());
      }),
    );
    return { seen };
  });
  const activity = yield* Effect.promise(() => host.get(Activity, {}));
  yield* Effect.promise(() => Promise.all([seeded.promise, observed.promise]));
  assert.equal(activity.seen.value, 1);
  activity.release();
  yield* Effect.promise(() => stopped.promise);
});

const plugins = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const Actions = defineRegistry<(ctx: chordTypes.Ctx) => Promise<number>>("tutorial.actions");
  const Menu = local("tutorial.menu", { input: Type.Object({}), version: 1 });
  let click: (() => Promise<number>) | undefined;
  const storeFacet: chordTypes.Facet = {
    name: "todo-store",
    ...defineFacet((api) => api.serve(TodoStore, todoFactory)),
  };
  const menuFacet: chordTypes.Facet = {
    name: "todo-menu",
    ...defineFacet(
      (api) => {
        api.serve(
          Menu,
          (_input, _principal, self) => {
            const todos = self.get(TodoStore, { list: "family" });
            self.register(Actions, {
              addSample: (ctx) =>
                todos.add({ text: "Try plugins" }, ctx).then(() => todos.openCount.value),
            });
            return {};
          },
          { lifetime: "host" },
        );
        click = () => api.root((ctx) => api.registry(Actions).get("addSample", ctx)!(ctx));
      },
      { uses: [TodoStore] },
    ),
  };
  const host = createHost({ self: "server" });
  yield* Effect.promise(() => host.load([menuFacet, storeFacet], { awaitHostObjects: false }));
  yield* Effect.promise(() => host.ready());
  assert.equal(yield* Effect.promise(() => click!()), 1);
  assert.equal(host.registry(Actions).table().size, 1);
});

const facet = (label: string): chordTypes.Facet => ({
  name: "todos",
  setup: (api) =>
    api.serve(TodoStore, (input, principal, self) => ({
      ...todoFactory(input, principal, self),
      label: () => label,
    })),
});

const compatibleReload = (host: chordTypes.Host, todos: chordTypes.Ref<typeof TodoStore>) =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const oldRoot = host.root((ctx) =>
      todos.label(ctx).then((first) => {
        entered.resolve();
        return resume.promise.then(() => todos.label(ctx)).then((second) => [first, second]);
      }),
    );
    yield* Effect.promise(() => entered.promise);
    const compatible = yield* Effect.promise(() => host.reload([facet("Updated")]));
    assert.deepEqual(compatible.gated, []);
    assert.equal(yield* Effect.promise(() => todos.label()), "Updated");
    resume.resolve();
    assert.deepEqual(yield* Effect.promise(() => oldRoot), ["Original", "Original"]);
    assert.equal(todos.rows.value?.[0]?.text, "Buy milk");
  });

const migrateRows = (host: chordTypes.Host, todos: chordTypes.Ref<typeof TodoStore>) =>
  Effect.gen(function* () {
    const events: string[] = [];
    const stopEvents = todos.rows.events((event) => events.push(event.type));
    const migrated = yield* Effect.promise(() =>
      host.reload([
        {
          name: "todos",
          setup: (api) =>
            api.serve(
              TodoStore,
              todoStore({
                migrate: (old, from) => {
                  assert.equal(from, 1);
                  return (old as Static<typeof Rows>).map((todo) =>
                    Object.assign(todo, { text: todo.text.toUpperCase() }),
                  );
                },
                version: 2,
              }),
            ),
        },
      ]),
    );
    assert.equal(migrated.gated.length, 1);
    assert.deepEqual(todos.rows.value, [{ done: false, text: "BUY MILK" }]);
    assert.deepEqual(events, ["snap", "reset"]);
    stopEvents();
  });

const { label: _label, ...members } = TodoStore.def.members;
const RenamedStore = local("tutorial.todos", {
  input: TodoStore.def.input,
  members: { ...members, heading: method(undefined, Type.String()) },
  version: 2,
});

const renameWithAdapter = (host: chordTypes.Host, todos: chordTypes.Ref<typeof TodoStore>) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      host.reload([
        {
          name: "todos",
          setup: (api) =>
            api.serve(
              RenamedStore,
              (input, principal, self) => {
                const { label, ...implementation } = todoStore({ version: 2 })(
                  input,
                  principal,
                  self,
                );
                return { ...implementation, heading: label };
              },
              {
                accepts: {
                  1: (current) => ({ ...current, label: current["heading"] }),
                },
              },
            ),
        },
      ]),
    );
    assert.equal(yield* Effect.promise(() => todos.label()), "Todos for family");
    const newer = yield* Effect.promise(() => host.get(RenamedStore, { list: "family" }));
    assert.equal(yield* Effect.promise(() => newer.heading()), "Todos for family");
    assert.equal(todos.rows.value?.[0]?.text, "BUY MILK");
  });

const reloadKeepsTheList = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost({ self: "server" });
  yield* Effect.promise(() => host.load([facet("Original")]));
  const todos = yield* Effect.promise(() => host.get(TodoStore, { list: "family" }));
  yield* Effect.promise(() => todos.add({ text: "Buy milk" }));
  yield* compatibleReload(host, todos);
  yield* migrateRows(host, todos);
  yield* renameWithAdapter(host, todos);
});

const fakeProvider = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost<Principal>({ dev: true, name: "server", self: "server" });
  const received: string[] = [];
  const fake: chordTypes.Facet = {
    name: "fake-store",
    ...defineFacet((api: chordTypes.FacetApi) => {
      api.serve(TodoStore, (input, principal, self) => ({
        ...todoFactory(input, principal, self),
        add: ({ text }) => {
          received.push(text);
        },
      }));
    }),
  };
  yield* Effect.promise(() => host.load([fake]));
  serveViews(host);
  const owner = yield* Effect.promise(() =>
    host.get(Todos, { list: "family" }, { principal: "owner" }),
  );
  assert.ok(owner.variant === "editor");
  yield* Effect.promise(() => owner.add({ text: "Test delegation" }));
  assert.deepEqual(received, ["Test delegation"]);
  yield* Effect.promise(() =>
    assert.rejects(owner.add({ text: "" }), (error) => isChordError(error, "invalid")),
  );
  owner.release();
  yield* Effect.promise(() =>
    assert.rejects(owner.add({ text: "Too late" }), (error) => isChordError(error, "released")),
  );
});

const shortRoots = Effect.gen(function* () {
  onTestFinished(() => host.close());
  const host = createHost({ self: "server" });
  host.serve(TodoStore, todoFactory);
  const screen = yield* Effect.promise(() => host.get(TodoStore, { list: "family" }));
  yield* Effect.promise(() =>
    host.root((ctx) =>
      ctx
        .get(TodoStore, { list: "family" })
        .then((temporary) => temporary.add({ text: "Keep roots short" }, ctx)),
    ),
  );
  assert.equal(screen.openCount.value, 1);
  screen.release();
});

it("07: listeners react and tasks start fresh calls", { timeout: 5000 }, () =>
  Effect.runPromise(listenersAndTasks),
);

it("08: plugins contribute registry entries and expose callbacks", { timeout: 5000 }, () =>
  Effect.runPromise(plugins),
);

it("09: compatible reload, migration and an old-contract adapter", { timeout: 5000 }, () =>
  Effect.runPromise(reloadKeepsTheList),
);

it("10: stub a provider with a fake facet and check error codes", { timeout: 5000 }, () =>
  Effect.runPromise(fakeProvider),
);

it("11: short roots release temporary holds", { timeout: 5000 }, () =>
  Effect.runPromise(shortRoots),
);
