import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, it, vi } from "vite-plus/test";

import { createHost, ipcLink, isChordError } from "../src/index.ts";
import {
  type ControlMessage,
  createHostManager,
  type Driver,
  type Exit,
  forkDriver,
  processLock,
} from "../src/manager.ts";
import { Echo } from "./fixtures/echo.ts";
import { makeDirectory, readText, removeAll } from "./fixtures/platform.ts";
import { latch, tick } from "./fixtures/timing.ts";

const entry = fileURLToPath(new URL("./fixtures/worker.ts", import.meta.url));
const scratch = (name: string) => `${tmpdir()}/chord2-${process.pid}-${name}`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const driver = (env: Record<string, string> = {}, lock?: string): Driver =>
  forkDriver({ entry, env: { HOST_NAME: "w1", ...env }, init: { greeting: "hi" }, lock });

const admitsOneHolderWhenTheTemporary = Effect.gen(function* () {
  const deep = `${scratch("deep")}/${"a".repeat(60)}/${"b".repeat(60)}`;
  yield* makeDirectory(deep);
  vi.stubEnv("TMPDIR", deep);
  yield* Effect.gen(function* () {
    const name = `deep-${process.pid}`;
    const release = yield* Effect.promise(() => processLock(name));
    yield* Effect.promise(() =>
      assert.rejects(
        processLock(name),
        (error) => isChordError(error) && error.reason === "locked",
      ),
    );
    yield* Effect.promise(() => release());
    const again = yield* Effect.promise(() => processLock(name));
    yield* Effect.promise(() => again());
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        vi.unstubAllEnvs();
      }).pipe(Effect.andThen(removeAll(scratch("deep")))),
    ),
  );
});

describe("processLock", () => {
  it("admits one holder when the temporary directory is too deep for a socket path", () =>
    Effect.runPromise(admitsOneHolderWhenTheTemporary));
});

const aChildWithoutALockDoes = Effect.gen(function* () {
  const name = `chord2-test-${process.pid}-inherited`;
  const release = yield* Effect.promise(() => processLock(name));
  vi.stubEnv("CHORD2_LOCK", name);
  const manager = createHostManager({ driver: driver() });
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => manager.start());
    assert.equal(manager.status, "running");
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        vi.unstubAllEnvs();
        yield* Effect.promise(() => manager.stop());
        yield* Effect.promise(() => release());
      }),
    ),
  );
});

const startsAChildHostLinksIt = Effect.gen(function* () {
  const manager = createHostManager({ driver: driver() });
  const instance = yield* Effect.promise(() => manager.start());
  assert.equal(manager.status, "running");
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.accept(instance.link, { principal: { worker: "w1" }, kind: "host", name: "w1" });
  const echo = server.hold(Echo, {});
  assert.equal(yield* Effect.promise(() => echo.echo("x")), `hi x from ${instance.pid}`);
  assert.equal(yield* Effect.promise(() => manager.start()), instance);
  yield* Effect.promise(() => manager.stop());
  assert.equal(manager.status, "stopped");
  assert.deepEqual(yield* Effect.promise(() => instance.exited), { code: 0, signal: null });
  yield* Effect.promise(() => server.close());
});

const aChildOwnedKernelLockAdmits = Effect.gen(function* () {
  const lock = `chord2-test-${process.pid}-lock`;
  const pids: number[] = [];
  const base = driver({}, lock);
  const watched: Driver = {
    spawn() {
      for (const pid of pids) assert.ok(!alive(pid), `pid ${pid} still alive`);
      return base.spawn().then((instance) => {
        pids.push(instance.pid);
        return instance;
      });
    },
  };
  const first = createHostManager({ driver: watched });
  const second = createHostManager({ driver: driver({}, lock) });
  const a = yield* Effect.promise(() => first.start());
  yield* Effect.promise(() =>
    assert.rejects(
      second.start(),
      (error) => isChordError(error, "unavailable") && error.reason === "locked",
    ),
  );
  const b = yield* Effect.promise(() => first.replace());
  assert.notEqual(a.pid, b.pid);
  yield* Effect.promise(() => first.stop());
  yield* Effect.promise(() => second.start());
  yield* Effect.promise(() => second.stop());
});

const aGracefulExitStillTakesThe = Effect.gen(function* () {
  const file = scratch("grandchild-graceful");
  yield* removeAll(file);
  const manager = createHostManager({ driver: driver({ GRANDCHILD_FILE: file }) });
  yield* Effect.promise(() => manager.start());
  const grandchild = Number(yield* readText(file));
  assert.ok(alive(grandchild));
  yield* Effect.promise(() => manager.stop());
  for (let i = 0; i < 50 && alive(grandchild); i++) yield* Effect.sleep(20);
  assert.ok(!alive(grandchild));
  yield* removeAll(file);
});

const idleforCountsFromTheBusyIdle = Effect.gen(function* () {
  const listeners = new Set<(message: ControlMessage) => void>();
  const fake: Driver = {
    spawn: () =>
      Promise.resolve({
        pid: 0,
        link: ipcLink({
          connected: false,
          send: () => false,
          on: () => undefined,
          off: () => undefined,
        }),
        exited: latch<Exit>().promise,
        send: () => {},
        killTree: () => {},
        onControl: (listener) => listeners.add(listener),
      }),
  };
  const emit = (message: ControlMessage) => {
    for (const listener of listeners) listener(message);
  };
  const manager = createHostManager({ driver: fake });
  const started = manager.start();
  for (let i = 0; i < 20 && listeners.size === 0; i++) yield* tick;
  emit({ type: "ready" });
  yield* Effect.promise(() => started);
  emit({ type: "status", activeCalls: 1 });
  yield* Effect.sleep(120);
  assert.equal(manager.liveness.idleFor, 0);
  emit({ type: "status", activeCalls: 0 });
  assert.ok(manager.liveness.idleFor < 60, `idleFor ${manager.liveness.idleFor}`);
});

const killsTheProcessTreeWhenA = Effect.gen(function* () {
  const file = scratch("grandchild");
  yield* removeAll(file);
  const manager = createHostManager({
    driver: driver({ FIXTURE_MODE: "ignore-shutdown", GRANDCHILD_FILE: file }),
    grace: 300,
  });
  const instance = yield* Effect.promise(() => manager.start());
  const grandchild = Number(yield* readText(file));
  assert.ok(alive(grandchild));
  yield* Effect.promise(() => manager.stop());
  assert.equal((yield* Effect.promise(() => instance.exited)).signal, "SIGKILL");
  for (let i = 0; i < 50 && alive(grandchild); i++) yield* Effect.sleep(20);
  assert.ok(!alive(grandchild));
  yield* removeAll(file);
});

const reportsAFatalChildAsA = Effect.gen(function* () {
  const manager = createHostManager({ driver: driver({ FIXTURE_MODE: "fatal" }) });
  yield* Effect.promise(() => assert.rejects(manager.start(), /fixture refuses to start/u));
  assert.equal(manager.status, "stopped");
});

const stopsAnIdleChildWhenKeepalive = Effect.gen(function* () {
  const exits: unknown[] = [];
  const manager = createHostManager({
    driver: driver(),
    keepAlive: (liveness) => !liveness.booting && liveness.idleFor < 150,
    checkInterval: 50,
    onExit: (exit) => exits.push(exit),
  });
  yield* Effect.promise(() => manager.start());
  for (let i = 0; i < 100 && manager.status !== "stopped"; i++) yield* Effect.sleep(20);
  assert.equal(manager.status, "stopped");
  assert.equal(exits.length, 1);
});

describe("host manager (real child processes)", () => {
  it(
    "a child without a lock does not inherit the parent's lock",
    () => Effect.runPromise(aChildWithoutALockDoes),
    20_000,
  );

  it(
    "starts a child host, links it, stops it gracefully",
    () => Effect.runPromise(startsAChildHostLinksIt),
    20_000,
  );

  it(
    "a child-owned kernel lock admits one live process; replace waits for the exit before the next start",
    () => Effect.runPromise(aChildOwnedKernelLockAdmits),
    20_000,
  );

  it(
    "a graceful exit still takes the child's descendants with it",
    () => Effect.runPromise(aGracefulExitStillTakesThe),
    20_000,
  );

  it("idleFor counts from the busy → idle transition", () =>
    Effect.runPromise(idleforCountsFromTheBusyIdle));

  it(
    "kills the process tree when a child ignores shutdown past the grace period",
    () => Effect.runPromise(killsTheProcessTreeWhenA),
    20_000,
  );

  it(
    "reports a fatal child as a failed start",
    () => Effect.runPromise(reportsAFatalChildAsA),
    20_000,
  );

  it(
    "stops an idle child when keepAlive says so",
    () => Effect.runPromise(stopsAnIdleChildWhenKeepalive),
    20_000,
  );
});
