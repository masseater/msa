import { Cause, Effect } from "effect";

import { bind } from "./contract.ts";
import { ChordError } from "./errors.ts";
import type { CodeVersionState } from "./host-types.ts";
import type { ObjectImpl } from "./object.ts";
import { RefImpl } from "./ref.ts";
import type { Candidate, ReloadReport } from "./reload-candidate.ts";
import type { Reload } from "./reload.ts";
import { hostLifetime, type Service } from "./service.ts";

export class ReloadPublish {
  readonly #reload: Reload;

  constructor(reload: Reload) {
    this.#reload = reload;
  }

  publish(): ReloadReport {
    const reload = this.#reload;
    const host = reload.host;
    const previous = host.current;
    const next: CodeVersionState = host.pending!;
    host.pending = undefined;
    host.codeVersions.set(next.id, next);
    host.previous = previous;
    host.current = next;
    const prepared = this.#installAll(previous.id, next.id);
    this.#settleOthers();
    host.installTables(next, reload.tables, true);
    this.#dropRemoved();
    for (const facet of reload.facets) host.facets.set(facet.name, facet);
    for (const name of reload.options.remove ?? []) host.facets.delete(name);
    for (const [name, run] of reload.facetRuns)
      reload.starts.push(() => host.facetRunChanged(name, run));
    for (const name of reload.options.remove ?? [])
      reload.starts.push(() => host.facetRunChanged(name, undefined));
    host.gating = undefined;
    for (const [name, service] of reload.services) this.#hostObject(name, service);
    return {
      codeVersion: next.id,
      previous: previous.id,
      changed: [...reload.changed],
      removed: [...reload.removed],
      prepared,
      gated: reload.gated.map(({ object }) => object.address),
    };
  }

  #installAll(previous: number, next: number): string[] {
    const reload = this.#reload;
    const prepared: string[] = [];
    for (const object of [...reload.host.objects.values()]) {
      if (reload.removed.has(object.typeName)) continue;
      const candidate = reload.candidates.get(object);
      if (candidate === undefined) {
        const installed = object.implementations.get(previous);
        if (installed !== undefined)
          object.implementations.set(next, { ...installed, codeVersion: next });
        continue;
      }
      if (object.status !== "live") continue;
      this.#install(candidate, next);
      prepared.push(object.address);
    }
    return prepared;
  }

  #settleOthers(): void {
    const reload = this.#reload;
    const host = reload.host;
    for (const { object, run, staged } of reload.candidates.values()) {
      if (object.status === "live") continue;
      staged?.discard();
      object.pending.delete(run.decls);
      Effect.runFork(
        object.activation
          .unwind(run)
          .pipe(Effect.catchCause((cause) => Effect.sync(() => host.report(Cause.squash(cause))))),
      );
    }
    for (const [object, staged] of reload.deferred) {
      if (object.status !== "live") {
        staged.discard();
        continue;
      }
      object.deferredRuntime = false;
      staged.activate();
      reload.starts.push(() => object.startTasks());
    }
  }

  #dropRemoved(): void {
    const reload = this.#reload;
    const host = reload.host;
    const reason = new ChordError("gone", "type no longer served");
    for (const object of [...host.objects.values()]) {
      if (reload.removed.has(object.typeName))
        object.dispose(true, reason).catch((error: unknown) => host.report(error));
    }
    for (const name of reload.removed) host.hostObjects.delete(name);
  }

  #hostObject(name: string, service: Service): void {
    const reload = this.#reload;
    const host = reload.host;
    if (
      hostLifetime(service) &&
      reload.changed.has(name) &&
      host.hostObjects.get(name)?.object?.status !== "live"
    ) {
      reload.starts.push(() => host.startHostObject(service));
    }
    const pinned = host.hostObjects.get(name);
    if (!hostLifetime(service) && pinned !== undefined) {
      host.hostObjects.delete(name);
      reload.starts.push(() => pinned.release());
    }
  }

  #install(candidate: Candidate, codeVersion: number): void {
    const reload = this.#reload;
    const { object, run, service } = candidate;
    const gated = candidate.reasons.length > 0;
    object.pending.delete(run.decls);
    object.tasks.stop();
    if (gated) {
      const kept = new Set(run.decls.derives.values());
      for (const derived of object.decls.derives.values()) if (!kept.has(derived)) derived.detach();
    }
    object.decls = run.decls;
    object.service = service;
    for (const [resource, declaration] of run.decls.adopted) resource.adopt(declaration);
    object.implementations.set(codeVersion, {
      codeVersion,
      service,
      implementation: run.implementation,
      decls: run.decls,
    });
    if (gated) {
      object.minCodeVersion = codeVersion;
      for (const old of [...object.implementations.keys()])
        if (old !== codeVersion) reload.host.retireImplementation(object, old);
    }
    object.lifecycle.refreshSchemas();
    for (const [name, cell] of run.decls.cells) {
      const schema = run.decls.cellSchemas.get(name)!;
      if (candidate.migrated.has(cell)) cell.reset(candidate.migrated.get(cell), schema);
      else cell.schema = schema;
    }
    const created = new Set(run.created.derives);
    for (const derived of run.created.derives) derived.attach(candidate.derived);
    for (const derived of run.decls.derives.values()) if (!created.has(derived)) derived.refresh();
    candidate.staged?.activate();
    reload.starts.push(() => object.startTasks());
    object.openGate();
    this.#rebind(object, service);
  }

  #rebind(object: ObjectImpl, service: Service): void {
    const host = this.#reload.host;
    const pinned = host.hostObjects.get(object.typeName);
    if (pinned?.object === object && pinned.contract.fingerprint !== service.contract.fingerprint) {
      const replacement = new RefImpl(object, service.contract, "host");
      object.addRef(replacement);
      host.hostObjects.set(object.typeName, replacement);
      pinned.release();
    }
    for (const ref of [...object.refs]) {
      if (ref.owner === "client") {
        try {
          bind(service.contract, service.options.accepts, ref.contract);
        } catch (error) {
          ref.gone(
            new ChordError(
              "upgrade_required",
              `${object.typeName} changed; reload the web facets`,
              {
                cause: error,
              },
            ),
          );
          object.release(ref);
          continue;
        }
      }
      ref.shapeChanged();
    }
  }
}
