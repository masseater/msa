import { Cause, Effect, Fiber } from "effect";
import { dual } from "effect/Function";

import { asChordError, ChordError } from "./errors.ts";
import type { HostLinks } from "./host-links.ts";
import type { Facet, PluginRef } from "./host-types.ts";
import { holdPublications } from "./publish.ts";
import type { Candidate, ReloadOptions, ReloadReport } from "./reload-candidate.ts";
import { ReloadGate } from "./reload-gate.ts";
import { ReloadPrepare } from "./reload-prepare.ts";
import { ReloadPublish } from "./reload-publish.ts";

export type { ReloadOptions, ReloadReport } from "./reload-candidate.ts";

type ReloadObject = Candidate["object"];

export interface ReloadRequest {
  readonly plugins: readonly PluginRef[];
  readonly options: ReloadOptions;
  readonly codeVersion?: number | undefined;
}

export const reloadError = (error: unknown): ChordError => {
  const cause = asChordError(error, "reload");
  if (/^reload aborted/u.test(cause.message.replace(/^[^:]*: /u, ""))) return cause;
  return new ChordError(cause.code, `reload aborted: ${cause.message}`, {
    cause,
    reason: cause.reason,
    details: cause.details,
  });
};

const dieWith =
  (map: (error: unknown) => unknown) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<never> =>
    Effect.die(map(Cause.squash(cause)));

export const endReload = (host: HostLinks): void => {
  host.reloadEnded();
};

const ABORTED_ROOTS_GRACE = 1000;

const until = (host: HostLinks, ready: () => boolean, ms: number): Effect.Effect<boolean> =>
  Effect.suspend(() =>
    ready()
      ? Effect.succeed(true)
      : Effect.callback<boolean>((resume) => {
          const stop = host.watchRetirement(() => {
            if (!ready()) return;
            stop();
            resume(Effect.succeed(true));
          });
          return Effect.sync(stop);
        }).pipe(Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.succeed(false) })),
  );

export class Reload {
  readonly host: HostLinks;
  readonly facets: readonly Facet[];
  readonly options: ReloadOptions;
  readonly codeVersion: number | undefined;
  readonly candidates = new Map<ReloadObject, Candidate>();
  readonly abort = new AbortController();
  readonly closed: [ReloadObject, Candidate["atGate"][number]][] = [];
  services = new Map<string, Candidate["service"]>();
  changed = new Set<string>();
  removed = new Set<string>();
  tables: ReturnType<HostLinks["buildTables"]> = new Map();
  gated: Candidate[] = [];
  rolledBack = false;
  readonly deferred = new Map<ReloadObject, NonNullable<Candidate["staged"]>>();
  readonly facetRuns = new Map<string, AbortController>();
  readonly starts: (() => void)[] = [];
  readonly preparer = new ReloadPrepare(this);
  readonly #gate = new ReloadGate(this);
  readonly #publish = new ReloadPublish(this);

  constructor(host: HostLinks, facets: readonly Facet[], request: ReloadRequest) {
    this.host = host;
    this.facets = facets;
    this.options = request.options;
    this.codeVersion = request.codeVersion;
  }

  prepare(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* this.waitForRetirement();
      this.preparer.load();
      this.preparer.checkProviders();
      yield* this.preparer.prepareAll();
      this.host.gating = this.changed;
      yield* this.#withDeadline(this.preparer.prepareAll(), "activations in flight did not finish");
      this.preparer.checkRefs();
      this.tables = this.host.buildTables(this.#entries());
      yield* this.#gate.gate();
      this.alive();
      this.#stage();
    }).pipe(
      Effect.catchCause((cause) =>
        this.rollback().pipe(Effect.andThen(dieWith(reloadError)(cause))),
      ),
    );
  }

  rollback(): Effect.Effect<void> {
    return this.#gate.rollback();
  }

  summary(): ReloadReport {
    const live = [...this.candidates.values()].filter(({ object }) => object.status === "live");
    return {
      codeVersion: this.host.pending?.id ?? this.host.current.id,
      previous: this.host.current.id,
      changed: [...this.changed],
      removed: [...this.removed],
      prepared: live.map(({ object }) => object.address),
      gated: this.gated.map(({ object }) => object.address),
    };
  }

  alive(): void {
    if (this.rolledBack)
      throw new ChordError("aborted", "reload aborted while preparing", { reason: "aborted" });
  }

  #stage(): void {
    for (const candidate of this.candidates.values()) {
      if (candidate.object.status === "live")
        candidate.staged = candidate.object.listeners.stage(candidate.run.decls);
    }
    for (const object of this.host.objects.values()) {
      if (object.status === "live" && object.deferredRuntime)
        this.deferred.set(object, object.listeners.stage(object.decls));
    }
  }

  waitForRetirement(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const host = this.host;
      const previous = host.previous;
      if (previous === undefined) return;
      const deadline = this.options.retireDeadline ?? 5000;
      const gone = (): boolean => host.previous !== previous;
      const retired = yield* until(host, () => gone() || host.retirable(), deadline);
      if (!retired && !gone()) {
        previous.abort.abort(
          new ChordError("superseded", `code version ${previous.id} was retired`),
        );
        yield* until(
          host,
          () => gone() || previous.roots.size === 0,
          Math.min(deadline, ABORTED_ROOTS_GRACE),
        );
      }
      if (!gone()) host.retire();
    });
  }

  #withDeadline<T>(work: Effect.Effect<T>, what: string): Effect.Effect<T> {
    const deadline = this.options.gateDeadline ?? 5000;
    return Effect.forkDetach(work, { startImmediately: true }).pipe(
      Effect.flatMap((fiber) =>
        Fiber.join(fiber).pipe(
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () =>
              Effect.die(
                new ChordError("aborted", `${what} within ${deadline} ms`, { reason: "deadline" }),
              ),
          }),
        ),
      ),
    );
  }

  #entries(): [ReloadObject, Candidate["run"]["decls"]][] {
    return this.host
      .liveDecls(true)
      .filter(([object]) => !this.removed.has(object.typeName))
      .map(([object, decls]) => [object, this.candidates.get(object)?.run.decls ?? decls]);
  }

  commit(beforeStart?: () => void): ReloadReport {
    try {
      return holdPublications(() => {
        const report = this.#publish.publish();
        beforeStart?.();
        for (const start of this.starts.splice(0)) start();
        return report;
      });
    } catch (error) {
      this.host.fail(error);
      throw reloadError(error);
    }
  }
}

export const beginReload: {
  (request: ReloadRequest): (host: HostLinks) => Effect.Effect<Reload>;
  (host: HostLinks, request: ReloadRequest): Effect.Effect<Reload>;
} = dual(2, (host: HostLinks, request: ReloadRequest): Effect.Effect<Reload> =>
  Effect.gen(function* () {
    if (host.reloading) {
      throw new ChordError("unavailable", "a reload is already running", {
        reason: "reload_running",
      });
    }
    host.reloading = true;
    const facets = yield* host
      .resolve(request.plugins)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => host.reloadEnded()).pipe(Effect.andThen(dieWith(reloadError)(cause))),
        ),
      );
    return new Reload(host, facets, request);
  }),
);

export const runReload: {
  (request: ReloadRequest): (host: HostLinks) => Effect.Effect<ReloadReport>;
  (host: HostLinks, request: ReloadRequest): Effect.Effect<ReloadReport>;
} = dual(2, (host: HostLinks, request: ReloadRequest): Effect.Effect<ReloadReport> =>
  Effect.gen(function* () {
    const reload = yield* beginReload(host, request);
    return yield* reload
      .prepare()
      .pipe(
        Effect.andThen(Effect.sync(() => reload.commit())),
        Effect.ensuring(Effect.sync(() => endReload(host))),
      );
  }),
);
