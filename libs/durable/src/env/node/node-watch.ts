import { type FSWatcher, watch as fsWatch } from "node:fs";

import type { Context } from "@msa/chord";
import { Cause, Effect } from "effect";

import env from "../index.ts";
import nodeTimer from "./node-timer.ts";
import nodeWatchErrors from "./node-watch-errors.ts";
import nodeWatchScan from "./node-watch-scan.ts";
import nodeWatchScope from "./node-watch-scope.ts";
import type nodeWatchScopeTypes from "./node-watch-scope.types.ts";
import type nodeWatchTypes from "./node-watch.types.ts";

const { anyUnreliable, scanTargets } = nodeWatchScan;
const { FileError } = env;
const { cancelTimer, startTimer } = nodeTimer;
const { keepsWatching, watchFailure } = nodeWatchErrors;
const { changedPaths, childOf, inScope, reportedPath, wantedWatchers } = nodeWatchScope;

type Installed = { readonly watcher: FSWatcher; readonly dev: number; readonly ino: number };

const DEBOUNCE_MS = 50;
const FSEVENTS_SETTLE_MS = 500;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_MAX_DIRECTORIES = 10_000;
const MAX_SYNC_ROUNDS = 10;

const resolveTargets = (
  targets: readonly nodeWatchTypes.WatchTarget[],
  resolvePath: (path: string) => string,
): nodeWatchScopeTypes.ResolvedTarget[] =>
  targets.map((target) => ({
    hidden: target.exclude?.hidden === true,
    names: new Set(target.exclude?.names ?? []),
    path: resolvePath(target.path),
    recursive: target.recursive === true,
  }));

export default class NodeFileWatcher implements nodeWatchTypes.FileWatcher {
  readonly #targets: readonly nodeWatchScopeTypes.ResolvedTarget[];
  readonly #onChange: (change: nodeWatchTypes.WatchChange) => void;
  readonly #pollIntervalMs: number;
  readonly #maxDirectories: number;
  readonly #watchers = new Map<string, Installed>();
  readonly #events = new Set<string>();
  #mode: "native" | "polling";
  #snapshot: nodeWatchScopeTypes.Snapshot = new Map();
  #timer: nodeWatchTypes.Timer | undefined;
  #settleTimer: nodeWatchTypes.Timer | undefined;
  #running: Promise<void> | undefined;
  #dirty = false;
  #closed = false;

  private constructor(
    targets: readonly nodeWatchScopeTypes.ResolvedTarget[],
    onChange: (change: nodeWatchTypes.WatchChange) => void,
    mode: "native" | "polling",
    options: nodeWatchTypes.NodeWatchOptions,
  ) {
    this.#targets = targets;
    this.#onChange = onChange;
    this.#mode = mode;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.#maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
  }

  static open(
    targets: readonly nodeWatchTypes.WatchTarget[],
    resolvePath: (path: string) => string,
    onChange: (change: nodeWatchTypes.WatchChange) => void,
    options: nodeWatchTypes.NodeWatchOptions,
  ): Promise<NodeFileWatcher> {
    const resolved = resolveTargets(targets, resolvePath);
    return Effect.runPromise(
      Effect.gen(function* () {
        const unreliable =
          options.mode === undefined &&
          (process.platform === "win32" ||
            (yield* anyUnreliable(resolved.map((target) => target.path))));
        const mode = options.mode ?? (unreliable ? "polling" : "native");
        const watcher = new NodeFileWatcher(resolved, onChange, mode, options);
        yield* watcher.#sync(false).pipe(
          Effect.onError(() => Effect.sync(() => watcher.#stop())),
          Effect.catchTag("BudgetExceeded", (error: nodeWatchTypes.BudgetExceeded) =>
            Effect.fail(new FileError("invalid", error.message)),
          ),
        );
        watcher.#schedulePoll();
        return watcher;
      }),
    );
  }

  get mode(): "native" | "polling" {
    return this.#mode;
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#stop();
    return this.#running ?? Promise.resolve();
  }

  #stop(): void {
    this.#closed = true;
    cancelTimer(this.#timer);
    this.#timer = undefined;
    cancelTimer(this.#settleTimer);
    this.#settleTimer = undefined;
    for (const { watcher } of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
  }

  #deliver(change: nodeWatchTypes.WatchChange): void {
    if (this.#closed) return;
    try {
      this.#onChange(change);
    } catch {}
  }

  #schedulePoll(): void {
    if (this.#closed || this.#mode !== "polling") return;
    this.#timer = startTimer(this.#pollIntervalMs, () => {
      this.#timer = undefined;
      void this.#flush().then(() => this.#schedulePoll());
    });
  }

  #scheduleFlush(): void {
    if (this.#closed || this.#timer !== undefined) return;
    this.#timer = startTimer(DEBOUNCE_MS, () => {
      this.#timer = undefined;
      void this.#flush();
    });
  }

  #scheduleSettle(): void {
    if (this.#closed) return;
    cancelTimer(this.#settleTimer);
    this.#settleTimer = startTimer(FSEVENTS_SETTLE_MS, () => {
      this.#settleTimer = undefined;
      void this.#flush();
    });
  }

  #flush(): Promise<void> {
    if (this.#running !== undefined) {
      this.#dirty = true;
      return this.#running;
    }
    const running = Effect.runPromise(
      this.#flushRounds().pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            this.#deliver({ error: watchFailure(Cause.squash(cause)) });
            this.#stop();
          }),
        ),
      ),
    ).finally(() => {
      if (this.#running === running) this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  #flushRounds(): Effect.Effect<void, nodeWatchTypes.BudgetExceeded> {
    return Effect.gen({ self: this }, function* () {
      do {
        this.#dirty = false;
        const events = [...this.#events];
        this.#events.clear();
        const changed = yield* this.#sync(true);
        for (const path of events) changed.add(path);
        if (changed.size > 0) this.#deliver({ paths: [...changed].sort() });
      } while (this.#dirty && !this.#closed);
    });
  }

  #sync(report: boolean): Effect.Effect<Set<string>, nodeWatchTypes.BudgetExceeded> {
    return Effect.gen({ self: this }, function* () {
      const changed = new Set<string>();
      for (let round = 0; round < MAX_SYNC_ROUNDS && !this.#closed; round++) {
        const scan = yield* scanTargets({
          maxDirectories: this.#maxDirectories,
          mode: this.#mode,
          targets: this.#targets,
        });
        if (this.#closed) break;
        if (report || round > 0) {
          const previous = this.#snapshot;
          for (const path of changedPaths(this.#targets, { next: scan.snapshot, previous })) {
            changed.add(path);
          }
        }
        this.#snapshot = scan.snapshot;
        if (this.#mode === "polling" || !this.#reconcileWatchers(scan)) break;
        if (process.platform === "darwin") this.#scheduleSettle();
      }
      return changed;
    });
  }

  #reconcileWatchers(scan: nodeWatchScopeTypes.Scan): boolean {
    const wanted = wantedWatchers(this.#targets, scan);
    for (const [path, installed] of this.#watchers) {
      const entry = scan.snapshot.get(path);
      const stale =
        !wanted.has(path) ||
        entry === undefined ||
        entry.dev !== installed.dev ||
        entry.ino !== installed.ino;
      if (stale) {
        installed.watcher.close();
        this.#watchers.delete(path);
      }
    }
    let added = false;
    for (const [path, recursive] of wanted) {
      const entry = scan.snapshot.get(path);
      if (this.#watchers.has(path) || entry === undefined) continue;
      const installed = this.#install(path, recursive, scan.linkedFiles.has(path));
      if (installed === "unsupported") {
        this.#switchToPolling();
        return false;
      }
      if (installed !== undefined) {
        this.#watchers.set(path, { dev: entry.dev, ino: entry.ino, watcher: installed });
        added = true;
      }
    }
    return added;
  }

  #install(
    path: string,
    recursive: boolean,
    linked: boolean,
  ): FSWatcher | "unsupported" | undefined {
    try {
      const watcher = fsWatch(path, { persistent: false, recursive }, (_event, filename) =>
        linked
          ? this.#onLinkedFileEvent(path)
          : this.#onEvent(path, filename === null ? undefined : String(filename)),
      );
      watcher.on("error", () => {
        watcher.close();
        if (this.#watchers.get(path)?.watcher === watcher) this.#watchers.delete(path);
        this.#scheduleFlush();
      });
      return watcher;
    } catch (error) {
      return keepsWatching(error) ? undefined : "unsupported";
    }
  }

  #switchToPolling(): void {
    if (this.#mode === "polling") return;
    this.#mode = "polling";
    for (const { watcher } of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
    this.#deliver({ overflow: true });
    cancelTimer(this.#timer);
    this.#timer = undefined;
    this.#schedulePoll();
  }

  #onEvent(directory: string, filename: string | undefined): void {
    if (this.#closed) return;
    const path = filename === undefined ? directory : childOf(directory, filename);
    const relevant = inScope(this.#targets, path);
    if (relevant) this.#events.add(reportedPath(this.#targets, path));
    if (relevant || filename === undefined) this.#scheduleFlush();
  }

  #onLinkedFileEvent(target: string): void {
    if (this.#closed) return;
    this.#events.add(target);
    this.#scheduleFlush();
  }
}
