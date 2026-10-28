import { Effect, Fiber } from "effect";

import type hostLinksTypes from "./host-links.types.ts";
import type hostTypesModule from "./host-types.types.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import reloadKit from "./reload-kit.ts";
import ReloadPrepare from "./reload-prepare.ts";
import ReloadPublish from "./reload-publish.ts";
import reloadModule from "./reload.ts";
import type reloadTypes from "./reload.types.ts";

const { errors: errorsModule, publish: publishModule, ReloadGate } = reloadKit;
const { ChordError } = errorsModule;

const { holdPublications } = publishModule;
type ReloadObject = reloadCandidateTypes.Candidate["object"];

const ABORTED_ROOTS_GRACE = 1000;

const until = (
  host: hostLinksTypes.HostLinks,
  ready: () => boolean,
  ms: number,
): Effect.Effect<boolean> =>
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

export default class Reload {
  readonly host: hostLinksTypes.HostLinks;
  readonly facets: readonly hostTypesModule.Facet[];
  readonly options: reloadCandidateTypes.ReloadOptions;
  readonly codeVersion: number | undefined;
  readonly candidates = new Map<ReloadObject, reloadCandidateTypes.Candidate>();
  readonly abort = new AbortController();
  readonly closed: [ReloadObject, reloadCandidateTypes.Candidate["atGate"][number]][] = [];
  services = new Map<string, reloadCandidateTypes.Candidate["service"]>();
  changed = new Set<string>();
  removed = new Set<string>();
  tables: ReturnType<hostLinksTypes.HostLinks["buildTables"]> = new Map();
  gated: reloadCandidateTypes.Candidate[] = [];
  rolledBack = false;
  readonly deferred = new Map<
    ReloadObject,
    NonNullable<reloadCandidateTypes.Candidate["staged"]>
  >();
  readonly facetRuns = new Map<string, AbortController>();
  readonly starts: (() => void)[] = [];
  readonly preparer = new ReloadPrepare(this);
  readonly #gate = new ReloadGate(this);
  readonly #publish = new ReloadPublish(this);

  constructor(
    host: hostLinksTypes.HostLinks,
    facets: readonly hostTypesModule.Facet[],
    request: reloadTypes.ReloadRequest,
  ) {
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
        this.rollback().pipe(Effect.andThen(reloadModule.dieWith(reloadModule.reloadError)(cause))),
      ),
    );
  }

  rollback(): Effect.Effect<void> {
    return this.#gate.rollback();
  }

  summary(): reloadCandidateTypes.ReloadReport {
    const live = [...this.candidates.values()].filter(({ object }) => object.status === "live");
    return {
      changed: [...this.changed],
      codeVersion: this.host.pending?.id ?? this.host.current.id,
      gated: this.gated.map(({ object }) => object.address),
      prepared: live.map(({ object }) => object.address),
      previous: this.host.current.id,
      removed: [...this.removed],
    };
  }

  alive(): void {
    if (this.rolledBack)
      throw ChordError.create("aborted", "reload aborted while preparing", { reason: "aborted" });
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
          ChordError.create("superseded", `code version ${previous.id} was retired`),
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
                ChordError.create("aborted", `${what} within ${deadline} ms`, {
                  reason: "deadline",
                }),
              ),
          }),
        ),
      ),
    );
  }

  #entries(): [ReloadObject, reloadCandidateTypes.Candidate["run"]["decls"]][] {
    return this.host
      .liveDecls(true)
      .filter(([object]) => !this.removed.has(object.typeName))
      .map(([object, decls]) => [object, this.candidates.get(object)?.run.decls ?? decls]);
  }

  commit(beforeStart?: () => void): reloadCandidateTypes.ReloadReport {
    try {
      return holdPublications(() => {
        const report = this.#publish.publish();
        beforeStart?.();
        for (const start of this.starts.splice(0)) start();
        return report;
      });
    } catch (error) {
      this.host.fail(error);
      throw reloadModule.reloadError(error);
    }
  }
}
