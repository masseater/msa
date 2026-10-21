import { Effect, Exit, Scope } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type managerTypes from "../src/manager.types.ts";
import HostTimers from "../src/timers.ts";
import timing from "./fixtures/timing.ts";
import managerKit from "./manager-kit.ts";

const { manager: managerModule, src: chord } = managerKit;
const { createHostManager } = managerModule;
const { createHost, hostNamed, ipcLink, memoryLinkPair, remote } = chord;
const { latch, ticks } = timing;

const LONG_MS = 60_000;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const Gated = remote("t.unref-gated", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: {} },
  version: 1,
});

const Dependent = remote("t.unref-dependent", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: {} },
  version: 1,
});

const gatedServer = () => {
  const gate = latch();
  const server = createHost({
    name: "server",
    onError: () => {},
    readyTimeout: LONG_MS,
    self: { kind: "host" },
  });
  server.serve(Gated, (_input, _principal, self) => {
    self.resource("gate", { open: () => gate.promise, version: 1 });
    return { variant: "main" };
  });
  server.serve(Dependent, (_input, _principal, self) => {
    self.get(Gated, {});
    return { variant: "main" };
  });
  return { open: gate.open, server };
};

const pendingHostTimersLeaveTheProcessFree = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const timers = new HostTimers(scope);
  const before = timersHoldingTheProcess();
  const stopAfter = timers.after(LONG_MS, () => undefined);
  const stopEvery = timers.every(LONG_MS, () => undefined);
  yield* ticks(3);
  const pending = timersHoldingTheProcess();
  stopAfter();
  stopEvery();
  yield* Scope.close(scope, Exit.void);
  expect(pending).toBe(before);
});

const hostTimersStillFire = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const timers = new HostTimers(scope);
  const fired: string[] = [];
  timers.after(5, () => fired.push("after"));
  const stopEvery = timers.every(5, () => fired.push("every"));
  yield* Effect.sleep(40);
  stopEvery();
  yield* Scope.close(scope, Exit.void);
  expect(fired).toContain("after");
  expect(fired.filter((name) => name === "every").length).toBeGreaterThan(1);
});

const activationReadyTimeoutLeavesTheProcessFree = Effect.gen(function* () {
  const { open, server } = gatedServer();
  const before = timersHoldingTheProcess();
  const held = server.hold(Dependent, {});
  held.ready.catch(() => {});
  yield* ticks(10);
  const pending = timersHoldingTheProcess();
  open();
  yield* Effect.promise(() => held.ready);
  held.release();
  yield* Effect.promise(() => server.close());
  expect(pending).toBe(before);
});

const remoteReadyTimeoutLeavesTheProcessFree = Effect.gen(function* () {
  const { open, server } = gatedServer();
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    readyTimeout: LONG_MS,
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  yield* ticks(10);
  const before = timersHoldingTheProcess();
  const got = browser.get(Gated, {});
  got.catch(() => {});
  yield* ticks(10);
  const pending = timersHoldingTheProcess();
  open();
  const ref = yield* Effect.promise(() => got);
  ref.release();
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
  expect(pending).toBe(before);
});

const fakeDriver = () => {
  const listeners = new Set<(message: managerTypes.ControlMessage) => void>();
  const exited = latch<managerTypes.Exit>();
  const driver: managerTypes.Driver = {
    spawn: () =>
      Promise.resolve({
        exited: exited.promise,
        killTree: () => exited.open({ code: null, signal: "SIGKILL" }),
        link: ipcLink({
          connected: false,
          off: () => undefined,
          on: () => undefined,
          send: () => false,
        }),
        onControl: (listener) => listeners.add(listener),
        pid: 0,
        send: (message) => {
          if (message.type === "shutdown") exited.open({ code: 0, signal: null });
        },
      }),
  };
  const emit = (message: managerTypes.ControlMessage): void => {
    for (const listener of listeners) listener(message);
  };
  return { driver, emit, listeners };
};

const keepAliveLeavesTheProcessFree = Effect.gen(function* () {
  const { driver, emit, listeners } = fakeDriver();
  const manager = createHostManager({ checkInterval: LONG_MS, driver, keepAlive: () => true });
  const before = timersHoldingTheProcess();
  const started = manager.start();
  for (let i = 0; i < 20 && listeners.size === 0; i++) yield* ticks(1);
  emit({ type: "ready" });
  yield* Effect.promise(() => started);
  yield* ticks(3);
  const pending = timersHoldingTheProcess();
  yield* Effect.promise(() => manager.stop());
  expect(manager.status).toBe("stopped");
  expect(pending).toBe(before);
});

describe("background chord timers leave the process free to exit", () => {
  it("while host linger, ack, and ping timers are pending", () =>
    Effect.runPromise(pendingHostTimersLeaveTheProcessFree));

  it("host timers still fire once and on every interval", () =>
    Effect.runPromise(hostTimersStillFire));

  it("while an object waits out the ready timeout of an object it references", () =>
    Effect.runPromise(activationReadyTimeoutLeavesTheProcessFree));

  it("while a remote get waits out its ready timeout", () =>
    Effect.runPromise(remoteReadyTimeoutLeavesTheProcessFree));

  it("while the manager's keep-alive loop waits for its next check", () =>
    Effect.runPromise(keepAliveLeavesTheProcessFree));
});
