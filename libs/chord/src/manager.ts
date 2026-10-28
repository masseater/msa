import { Clock, Effect, Fiber, Option, Semaphore } from "effect";

import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import managerChild from "./manager-child.ts";
import managerFork from "./manager-fork.ts";
import managerLock from "./manager-lock.ts";
import type managerTypesModule from "./manager-types.types.ts";
import sleep from "./sleep.ts";

const { unrefSleep } = sleep;

const { ChordError } = errorsModule;

interface Report {
  readonly activeCalls: number;
  readonly viewers: number;
  readonly durableTasks: number;
}

const NO_WORK: Report = { activeCalls: 0, durableTasks: 0, viewers: 0 };

interface ManagerState {
  readonly options: managerTypesModule.HostManagerOptions;
  readonly lock: Semaphore.Semaphore;
  status: managerTypesModule.HostManager["status"];
  instance: managerTypesModule.Instance | undefined;
  report: Report;
  idleSince: number | undefined;
  booting: boolean;
  keepAlive: Fiber.Fiber<unknown> | undefined;
}

const now = (): number => Effect.runSync(Clock.currentTimeMillis);

const working = (report: Report): boolean =>
  report.activeCalls + report.viewers + report.durableTasks > 0;

const livenessOf = (state: ManagerState): managerTypesModule.Liveness => ({
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

function updateReport(
  state: ManagerState,
  message: managerTypesModule.ControlMessage & { type: "status" },
): void {
  state.report = {
    activeCalls: message.activeCalls ?? 0,
    durableTasks: message.durableTasks ?? 0,
    viewers: message.viewers ?? 0,
  };
  if (working(state.report)) state.idleSince = undefined;
  else state.idleSince ??= now();
}

const readySignal = (
  state: ManagerState,
  current: managerTypesModule.Instance,
): Effect.Effect<void, errorsTypes.ChordError> =>
  Effect.callback<void, errorsTypes.ChordError>((resume) => {
    void current.exited.then((exit) =>
      resume(
        Effect.fail(
          ChordError.create(
            "unavailable",
            `child exited before ready (${exit.code ?? exit.signal})`,
          ),
        ),
      ),
    );
    current.onControl((message) => {
      if (message.type === "ready") resume(Effect.void);
      else if (message.type === "fatal")
        resume(
          Effect.fail(
            ChordError.create("unavailable", `child failed: ${message.message}`, {
              reason: message.reason,
            }),
          ),
        );
      else if (message.type === "status") updateReport(state, message);
    });
  });

const awaitReady = (
  state: ManagerState,
  current: managerTypesModule.Instance,
): Effect.Effect<void> =>
  readySignal(state, current).pipe(
    Effect.timeoutOrElse({
      duration: state.options.readyTimeout ?? 30_000,
      orElse: () => Effect.fail(ChordError.create("unavailable", "child not ready in time")),
    }),
    Effect.tapError(() =>
      Effect.promise(() => {
        current.killTree();
        return current.exited;
      }),
    ),
    Effect.orDie,
  );

function watchExit(state: ManagerState, current: managerTypesModule.Instance): void {
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
    Effect.forever(Effect.andThen(unrefSleep(state.options.checkInterval ?? 1000), check)),
  );
}

function finishStart(state: ManagerState): void {
  state.booting = false;
  if (!working(state.report)) state.idleSince ??= now();
  state.status = "running";
  startKeepAlive(state);
}

function spawn(state: ManagerState): Effect.Effect<managerTypesModule.Instance> {
  return Effect.promise(() => state.options.driver.spawn()).pipe(
    Effect.tapDefect(() =>
      Effect.sync(() => {
        state.status = "stopped";
        state.booting = false;
      }),
    ),
  );
}

const doStart = (state: ManagerState): Effect.Effect<managerTypesModule.Instance> =>
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

function createHostManager(
  options: managerTypesModule.HostManagerOptions,
): managerTypesModule.HostManager {
  const state: ManagerState = {
    booting: false,
    idleSince: undefined,
    instance: undefined,
    keepAlive: undefined,
    lock: Semaphore.makeUnsafe(1),
    options,
    report: NO_WORK,
    status: "stopped",
  };
  return {
    get instance() {
      return state.instance;
    },
    get liveness() {
      return livenessOf(state);
    },
    replace: () => serialized(state, Effect.andThen(doStop(state), doStart(state))),
    start: () => serialized(state, doStart(state)),
    get status() {
      return state.status;
    },
    stop: () => serialized(state, doStop(state)),
  };
}

const manager = {
  childControl: managerChild.childControl,
  createHostManager,
  forkDriver: managerFork.forkDriver,
  parentChannel: managerChild.parentChannel,
  processLock: managerLock.processLock,
};

export default manager;
