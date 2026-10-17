import { Clock, Effect, Fiber, Option, Semaphore } from "effect";

import { ChordError } from "./errors.ts";
import type {
  ControlMessage,
  HostManager,
  HostManagerOptions,
  Instance,
  Liveness,
} from "./manager-types.ts";

export { childControl, parentChannel } from "./manager-child.ts";
export { forkDriver } from "./manager-fork.ts";
export { processLock } from "./manager-lock.ts";
export type {
  ControlMessage,
  Driver,
  Exit,
  ForkDriverOptions,
  HostManager,
  HostManagerOptions,
  Instance,
  Liveness,
} from "./manager-types.ts";

interface Report {
  readonly activeCalls: number;
  readonly viewers: number;
  readonly durableTasks: number;
}

const NO_WORK: Report = { activeCalls: 0, viewers: 0, durableTasks: 0 };

interface ManagerState {
  readonly options: HostManagerOptions;
  readonly lock: Semaphore.Semaphore;
  status: HostManager["status"];
  instance: Instance | undefined;
  report: Report;
  idleSince: number | undefined;
  booting: boolean;
  keepAlive: Fiber.Fiber<unknown> | undefined;
}

const now = (): number => Effect.runSync(Clock.currentTimeMillis);

const working = (report: Report): boolean =>
  report.activeCalls + report.viewers + report.durableTasks > 0;

const livenessOf = (state: ManagerState): Liveness => ({
  booting: state.booting,
  ...state.report,
  idleFor: state.idleSince === undefined ? 0 : now() - state.idleSince,
});

const serialized = <A>(state: ManagerState, step: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(Semaphore.withPermits(state.lock, 1)(step));

function stopKeepAlive(state: ManagerState): void {
  const fiber = state.keepAlive;
  state.keepAlive = undefined;
  if (fiber !== undefined) Effect.runFork(Fiber.interrupt(fiber));
}

const doStop = (state: ManagerState): Effect.Effect<void> =>
  Effect.suspend(() => {
    const current = state.instance;
    if (current === undefined) {
      state.status = "stopped";
      state.booting = false;
      return Effect.void;
    }
    state.status = "stopping";
    stopKeepAlive(state);
    current.send({ type: "shutdown" });
    const exited = Effect.promise(() => current.exited);
    return exited.pipe(
      Effect.timeoutOption(state.options.grace ?? 5000),
      Effect.flatMap((graceful) => {
        if (Option.isNone(graceful)) current.killTree();
        return exited;
      }),
      Effect.andThen(
        Effect.sync(() => {
          if (state.instance === current) state.instance = undefined;
          state.status = "stopped";
        }),
      ),
    );
  });

function updateReport(state: ManagerState, message: ControlMessage & { type: "status" }): void {
  state.report = {
    activeCalls: message.activeCalls ?? 0,
    viewers: message.viewers ?? 0,
    durableTasks: message.durableTasks ?? 0,
  };
  if (working(state.report)) state.idleSince = undefined;
  else state.idleSince ??= now();
}

const readySignal = (state: ManagerState, current: Instance): Effect.Effect<void, ChordError> =>
  Effect.callback<void, ChordError>((resume) => {
    void current.exited.then((exit) =>
      resume(
        Effect.fail(
          new ChordError("unavailable", `child exited before ready (${exit.code ?? exit.signal})`),
        ),
      ),
    );
    current.onControl((message) => {
      if (message.type === "ready") resume(Effect.void);
      else if (message.type === "fatal")
        resume(
          Effect.fail(
            new ChordError("unavailable", `child failed: ${message.message}`, {
              reason: message.reason,
            }),
          ),
        );
      else if (message.type === "status") updateReport(state, message);
    });
  });

const awaitReady = (state: ManagerState, current: Instance): Effect.Effect<void> =>
  readySignal(state, current).pipe(
    Effect.timeoutOrElse({
      duration: state.options.readyTimeout ?? 30_000,
      orElse: () => Effect.fail(new ChordError("unavailable", "child not ready in time")),
    }),
    Effect.tapError(() =>
      Effect.promise(() => {
        current.killTree();
        return current.exited;
      }),
    ),
    Effect.orDie,
  );

function watchExit(state: ManagerState, current: Instance): void {
  Effect.runFork(
    Effect.map(
      Effect.promise(() => current.exited),
      (exit) => {
        if (state.instance === current) {
          state.instance = undefined;
          state.status = "stopped";
          stopKeepAlive(state);
        }
        state.options.onExit?.(exit);
      },
    ),
  );
}

function startKeepAlive(state: ManagerState): void {
  const keepAlive = state.options.keepAlive;
  if (keepAlive === undefined) return;
  const check = Effect.sync(() => {
    if (state.status === "running" && !keepAlive(livenessOf(state)))
      void serialized(state, doStop(state));
  });
  state.keepAlive = Effect.runFork(
    Effect.forever(Effect.delay(check, state.options.checkInterval ?? 1000)),
  );
}

function finishStart(state: ManagerState): void {
  state.booting = false;
  if (!working(state.report)) state.idleSince ??= now();
  state.status = "running";
  startKeepAlive(state);
}

function spawn(state: ManagerState): Effect.Effect<Instance> {
  return Effect.promise(() => state.options.driver.spawn()).pipe(
    Effect.tapDefect(() =>
      Effect.sync(() => {
        state.status = "stopped";
        state.booting = false;
      }),
    ),
  );
}

const doStart = (state: ManagerState): Effect.Effect<Instance> =>
  Effect.suspend(() => {
    if (state.instance !== undefined && state.status === "running")
      return Effect.succeed(state.instance);
    state.status = "starting";
    state.booting = true;
    state.report = NO_WORK;
    return Effect.flatMap(spawn(state), (current) => {
      state.instance = current;
      watchExit(state, current);
      return awaitReady(state, current).pipe(
        Effect.map(() => {
          finishStart(state);
          return current;
        }),
      );
    });
  });

export function createHostManager(options: HostManagerOptions): HostManager {
  const state: ManagerState = {
    options,
    lock: Semaphore.makeUnsafe(1),
    status: "stopped",
    instance: undefined,
    report: NO_WORK,
    idleSince: undefined,
    booting: false,
    keepAlive: undefined,
  };
  return {
    get status() {
      return state.status;
    },
    get instance() {
      return state.instance;
    },
    get liveness() {
      return livenessOf(state);
    },
    start: () => serialized(state, doStart(state)),
    stop: () => serialized(state, doStop(state)),
    replace: () => serialized(state, Effect.andThen(doStop(state), doStart(state))),
  };
}
