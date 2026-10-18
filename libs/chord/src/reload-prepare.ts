import { Effect } from "effect";

import { type AnyContract, bind, coverage } from "./contract.ts";
import { ChordError, invalid } from "./errors.ts";
import type { Serve } from "./host-types.ts";
import type { ObjectImpl } from "./object.ts";
import { type Candidate, dryRun } from "./reload-candidate.ts";
import type { Reload } from "./reload.ts";
import type { ResourceImpl } from "./resource.ts";
import { assertValid, deepEqual } from "./schema.ts";
import { type Factory, makeService, type ServeOptions } from "./service.ts";

export class ReloadPrepare {
  readonly #reload: Reload;

  constructor(reload: Reload) {
    this.#reload = reload;
  }

  load(): void {
    const reload = this.#reload;
    const host = reload.host;
    const replaced = new Set([
      ...reload.facets.map((facet) => facet.name),
      ...(reload.options.remove ?? []),
    ]);
    const current = host.current.services;
    reload.services = new Map([...current].filter(([, service]) => !replaced.has(service.facet)));
    for (const facet of reload.facets) {
      const run = new AbortController();
      reload.facetRuns.set(facet.name, run);
      facet.setup(
        host.facetApi(
          ((type: AnyContract, factory: Factory<AnyContract>, options: ServeOptions = {}) =>
            host.serveInto(
              reload.services,
              makeService(type, factory, options, facet.name),
            )) as Serve,
          run.signal,
        ),
      );
    }
    for (const [name, service] of reload.services)
      if (current.get(name) !== service) reload.changed.add(name);
    for (const name of current.keys()) if (!reload.services.has(name)) reload.removed.add(name);
    host.pending = {
      id: host.nextCodeVersionId(reload.codeVersion),
      services: reload.services,
      tables: new Map(),
      roots: new Map(),
      abort: new AbortController(),
    };
  }

  checkProviders(): void {
    const reload = this.#reload;
    for (const name of reload.changed) {
      const next = reload.services.get(name)!.contract;
      const old = reload.host.current.services.get(name)?.contract;
      if (old === undefined || old.version !== next.version) continue;
      const reason = coverage(next.description, old.description);
      if (reason !== undefined) {
        throw new ChordError(
          "contract_mismatch",
          `${name}@${next.version} changed incompatibly without a version bump (${reason})`,
        );
      }
    }
    const facets = new Map(reload.host.facets);
    for (const facet of reload.facets) facets.set(facet.name, facet);
    for (const name of reload.options.remove ?? []) facets.delete(name);
    for (const facet of facets.values()) {
      for (const token of facet.uses ?? []) {
        const service = reload.services.get(token.name);
        if (service !== undefined && reload.changed.has(token.name))
          bind(service.contract, service.options.accepts, token);
      }
    }
  }

  prepareAll(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reload = this.#reload;
      for (;;) {
        const todo = [...reload.host.objects.values()].filter(
          (object) =>
            reload.changed.has(object.typeName) &&
            !reload.candidates.has(object) &&
            object.service !== reload.services.get(object.typeName) &&
            (object.status === "live" || object.status === "activating"),
        );
        if (todo.length === 0) return;
        yield* Effect.promise(() => Promise.allSettled(todo.map((object) => object.ready)));
        reload.alive();
        for (const object of todo) {
          if (object.status === "live" && object.service !== reload.services.get(object.typeName)) {
            yield* this.#prepareObject(object);
            reload.alive();
          }
        }
      }
    });
  }

  #prepareObject(object: ObjectImpl): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reload = this.#reload;
      const candidate = this.#candidate(object);
      const { run } = candidate;
      const deferred = new Set<ResourceImpl>();
      for (const resource of run.created.resources) {
        if (resource.exclusive || resource.deps.some((dep) => deferred.has(dep as ResourceImpl)))
          deferred.add(resource);
      }
      for (const resource of deferred) {
        candidate.atGate.push(resource);
        const old = object.decls.resources.get(resource.key);
        if (resource.exclusive && old?.exclusive === true && old.state === "open")
          candidate.replaced.push(old);
      }
      if (deferred.size > 0) candidate.reasons.push("exclusive resource replaced");
      yield* object.activation.open(
        run.created.resources.filter((resource) => !deferred.has(resource)),
        run.created.refs,
        reload.abort.signal,
      );
      yield* object.activation.waitHydrated(run);
      if (candidate.reasons.length === 0) {
        yield* object.activation.initCells(run, reload.abort.signal);
        dryRun(candidate);
      }
    });
  }

  #candidate(object: ObjectImpl): Candidate {
    const reload = this.#reload;
    const service = reload.services.get(object.typeName)!;
    const run = object.activation.run(service, object.decls);
    const candidate: Candidate = {
      object,
      service,
      run,
      reasons: [],
      atGate: [],
      replaced: [],
      migrated: new Map(),
      derived: new Map(),
      staged: undefined,
    };
    reload.candidates.set(object, candidate);
    for (const [name, cell] of run.decls.cells) {
      if (object.decls.cells.get(name) !== cell) continue;
      const from = object.decls.cellVersions.get(name) ?? 1;
      const to = run.decls.cellVersions.get(name) ?? 1;
      if (to < from)
        throw invalid(
          "state",
          `${object.address}: version of state ${name} lowered from ${from} to ${to}`,
        );
      if (to > from) candidate.reasons.push(`state ${name} version ${from} -> ${to}`);
      else if (!deepEqual(cell.schema, run.decls.cellSchemas.get(name)))
        throw invalid(
          "state",
          `${object.address}: schema of state ${name} changed without a version bump`,
        );
    }
    return candidate;
  }

  checkRefs(): void {
    const reload = this.#reload;
    const dropped = new Set<unknown>();
    for (const { object, run } of reload.candidates.values()) {
      for (const ref of object.decls.refs.values())
        if (![...run.decls.refs.values()].includes(ref)) dropped.add(ref);
    }
    for (const object of reload.host.objects.values()) {
      const service = reload.services.get(object.typeName);
      if (service === undefined || !reload.changed.has(object.typeName)) continue;
      for (const ref of object.refs) {
        if (ref === reload.host.hostObjects.get(object.typeName)) continue;
        if (!dropped.has(ref) && ref.owner !== "client")
          bind(service.contract, service.options.accepts, ref.contract);
      }
    }
  }

  migrate(candidate: Candidate): void {
    const { object, run } = candidate;
    for (const [name, cell] of run.decls.cells) {
      if (object.decls.cells.get(name) !== cell) continue;
      const schema = run.decls.cellSchemas.get(name)!;
      const from = object.decls.cellVersions.get(name) ?? 1;
      const fn = run.decls.cellMigrations.get(name);
      let value: unknown;
      if ((run.decls.cellVersions.get(name) ?? 1) > from && fn !== undefined)
        value = fn(structuredClone(cell.value), from);
      else if (deepEqual(cell.schema, schema)) continue;
      else value = cell.value;
      assertValid("state", `${object.address}: migrated state ${name}`, schema, value);
      candidate.migrated.set(cell, value);
    }
    dryRun(candidate);
  }
}
