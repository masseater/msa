import testing from "@msa/testing";
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
const { latch, pollUntil, ticks } = timing;
const { timersArmedBy } = testing;

const LONG_MS = 60_000;

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
  const [stops, armed] = yield* timersArmedBy(
    Effect.gen(function* () {
      const stopAfter = timers.after(LONG_MS, () => undefined);
      const stopEvery = timers.every(LONG_MS, () => undefined);
      yield* ticks(3);
      return [stopAfter, stopEvery];
    }),
  );
  for (const stop of stops) stop();
  yield* Scope.close(scope, Exit.void);
  expect(armed.armed).toBeGreaterThan(0);
  expect(armed.holding).toBe(0);
});

const hostTimersStillFire = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const timers = new HostTimers(scope);
  const fired: string[] = [];
  const everyTicks = (): number => fired.filter((name) => name === "every").length;
  timers.after(5, () => fired.push("after"));
  const stopEvery = timers.every(5, () => fired.push("every"));
  yield* pollUntil(() => fired.includes("after") && everyTicks() > 1, 400, Effect.sleep(5));
  stopEvery();
  yield* Scope.close(scope, Exit.void);
  expect(fired.filter((name) => name === "after")).toHaveLength(1);
  expect(everyTicks()).toBeGreaterThan(1);
});

const activationReadyTimeoutLeavesTheProcessFree = Effect.gen(function* () {
  const { open, server } = gatedServer();
  const [held, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      const holding = server.hold(Dependent, {});
      holding.ready.catch(() => {});
      yield* ticks(10);
      return holding;
    }),
  );
  open();
  yield* Effect.promise(() => held.ready);
  held.release();
  yield* Effect.promise(() => server.close());
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
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
  const [{ got }, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      const getting = browser.get(Gated, {});
      getting.catch(() => {});
      yield* ticks(10);
      return { got: getting };
    }),
  );
  open();
  const ref = yield* Effect.promise(() => got);
  ref.release();
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
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
  const [, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      const started = manager.start();
      yield* pollUntil(() => listeners.size !== 0, 20, ticks(1));
      emit({ type: "ready" });
      yield* Effect.promise(() => started);
      yield* ticks(3);
    }),
  );
  yield* Effect.promise(() => manager.stop());
  expect(manager.status).toBe("stopped");
  expect(timers.armed).toBeGreaterThan(0);
  expect(timers.holding).toBe(0);
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
