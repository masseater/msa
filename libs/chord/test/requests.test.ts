import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  defineFacet,
  defineRegistry,
  type Facet,
  type FacetApi,
  hostNamed,
  local,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import { View, until } from "./fixtures/requests.ts";
import { tick } from "./fixtures/timing.ts";

const case1AHeldObjectSState = Effect.gen(function* () {
  const Conv = remote("t.conv", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { main: { state: { view: View }, methods: { set: method(Type.String()) } } },
  });
  const Chat = remote("t.chat", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { viewer: { state: { view: View } } },
  });
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(Conv, (_input, _principal, self) => {
    const view = self.state("view", View, { text: "" });
    return {
      variant: "main",
      view,
      set: (text, ctx) => {
        view.replace(ctx, { text });
      },
    };
  });
  server.serve(Chat, (_input, _principal, self) => {
    const conv = self.get(Conv, {});
    return { variant: "viewer", view: conv.view };
  });
  const chat = server.hold(Chat, {});
  const values: unknown[] = [];
  chat.view.subscribe((value) => values.push(value));
  yield* Effect.promise(() => chat.ready);
  yield* Effect.promise(() => server.hold(Conv, {}).set("hi"));
  yield* tick;
  assert.deepEqual(chat.view.value, { text: "hi" });
  assert.deepEqual(values.at(-1), { text: "hi" });

  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
  });
  const remoteChat = browser.hold(Chat, {});
  yield* Effect.promise(() => remoteChat.ready);
  yield* Effect.promise(() => server.hold(Conv, {}).set("there"));
  yield* until(() => (remoteChat.view.value as { text: string } | undefined)?.text === "there");
});

const case2FacetsReachTheirOwnHost = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const Config = defineRegistry<string>("t.config");
  const Settings = local("t.settings", { version: 1, input: Type.Object({}) });
  const Reader = local("t.reader", {
    version: 1,
    input: Type.Object({}),
    members: { read: method(undefined, Type.String()) },
  });
  const captured: FacetApi[] = [];
  const facet = (value: string): Facet => ({
    name: "config",
    ...defineFacet((api) => {
      captured.push(api);
      api.serve(
        Settings,
        (_input, _principal, self) => {
          self.register(Config, { greeting: value });
          return {};
        },
        { lifetime: "host" },
      );
      api.serve(Reader, () => ({
        read: (ctx: Ctx) => api.registry(Config).get("greeting", ctx) ?? "",
      }));
    }),
  });
  const host = createHost({ self: { kind: "host" }, name: "worker", onError: () => {} });
  host.install(facet("v1"));
  yield* Effect.sleep(5);
  const api = captured[0]!;
  assert.equal(api.name, "worker");
  assert.equal(
    yield* Effect.promise(() =>
      api.root((ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const peer = yield* Effect.promise(() => ctx.get(Reader, {}));
            return yield* Effect.promise(() => peer.read(ctx));
          }),
        ),
      ),
    ),
    "v1",
  );
  yield* Effect.promise(() => host.reload([facet("v2")]));
  yield* Effect.sleep(5);
  assert.equal(captured[1]!.registry(Config).get("greeting"), "v2");
  assert.equal(
    yield* Effect.promise(() =>
      api.root((ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const peer = yield* Effect.promise(() => ctx.get(Reader, {}));
            return yield* Effect.promise(() => peer.read(ctx));
          }),
        ),
      ),
    ),
    "v2",
  );
});

const case3AListenerKeepsItsSubscription = Effect.gen(function* () {
  const Watcher = local("t.watcher", {
    version: 1,
    input: Type.Object({}),
    members: { seen: Type.Array(Type.String()) },
  });
  let subscribers = 0;
  let emit = (_event: string) => {};
  const single = {
    start: (fn: (event: string) => void) => {
      if (subscribers > 0) throw new Error("Watch is already started");
      subscribers++;
      emit = fn;
      return () => {
        subscribers--;
      };
    },
  };
  const facet = (tag: string): Facet => ({
    name: "watcher",
    setup: (api) =>
      api.serve(Watcher, (_input, _principal, self) => {
        const seen = self.state("seen", Type.Array(Type.String()), []);
        const watchResource = self.resource("watch", { version: 1, open: () => single });
        self.on(
          "events",
          watchResource,
          (watch) => ({ subscribe: (fn: (event: string) => void) => watch.start(fn) }),
          (event, ctx) => seen.change(ctx, (draft) => void draft.push(`${tag}:${event}`)),
        );
        return { seen };
      }),
  });
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  host.install(facet("v1"));
  const ref = host.hold(Watcher, {});
  yield* Effect.promise(() => ref.ready);
  emit("a");
  yield* Effect.promise(() => host.reload([facet("v2")]));
  yield* Effect.promise(() => host.reload([facet("v3")]));
  emit("b");
  yield* Effect.sleep(5);
  assert.equal(subscribers, 1);
  assert.deepEqual(ref.seen.value, ["v1:a", "v3:b"]);
});

const case3AChangedSelectResubscribes = Effect.gen(function* () {
  const Watcher = local("t.watcher2", { version: 1, input: Type.Object({}) });
  let subscribes = 0;
  const source = {
    subscribe: () => {
      subscribes++;
      return () => {};
    },
  };
  const facet = (selectText: boolean): Facet => ({
    name: "watcher2",
    setup: (api) =>
      api.serve(Watcher, (_input, _principal, self) => {
        const sResource = self.resource("s", { version: 1, open: () => source });
        self.on("s", sResource, selectText ? (s) => s : (value) => value, () => {});
        return {};
      }),
  });
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  host.install(facet(true));
  yield* Effect.promise(() => host.hold(Watcher, {}).ready);
  yield* Effect.promise(() => host.reload([facet(true)]));
  assert.equal(subscribes, 1);
  yield* Effect.promise(() => host.reload([facet(false)]));
  assert.equal(subscribes, 2);
});

describe("application requests", () => {
  it("#1 a held object's state member can be returned as this object's state member", () =>
    Effect.runPromise(case1AHeldObjectSState));

  it("#2 facets reach their own host through FacetApi.root and FacetApi.registry", () =>
    Effect.runPromise(case2FacetsReachTheirOwnHost));

  it("#3 a listener keeps its subscription across reloads when resource and select are unchanged", () =>
    Effect.runPromise(case3AListenerKeepsItsSubscription));

  it("#3 a changed select resubscribes", () => Effect.runPromise(case3AChangedSelectResubscribes));
});
