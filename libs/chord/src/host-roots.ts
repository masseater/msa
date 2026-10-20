import { Cause, Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import type coreTypes from "./core.types.ts";
import type ctxTypes from "./ctx.types.ts";
import type declsTypes from "./decls.types.ts";
import hostRootsKit from "./host-roots-kit.ts";
import type hostRootsTypes from "./host-roots.types.ts";
import type hostTypesModule from "./host-types.types.ts";
import type objectTypes from "./object.types.ts";
import type typesModule from "./types.types.ts";

const { CtxImpl, errors: errorsModule, HostBase } = hostRootsKit;

const { ChordError, runAll } = errorsModule;
export default abstract class HostRoots extends HostBase {
  readonly #local = new Set<string>();
  readonly #foreign = new Map<string, Set<connectionTypes.Connection>>();
  readonly #rootLinks = new Map<string, Set<connectionTypes.Connection>>();
  readonly #touches = new Map<string, Set<objectTypes.ObjectImpl>>();
  readonly #retirementWatchers = new Set<() => void>();
  #retireAllowed = 0;
  #rootSeq = 0;

  root<T>(
    fn: (ctx: typesModule.Ctx) => T | Promise<T>,
    options: hostTypesModule.RootOptions = {},
  ): Promise<T> {
    this.#rootSeq += 1;
    const rootId = `${this.name}#${this.incarnation}:${this.#rootSeq}`;
    this.#local.add(rootId);
    return this.joinRoot(rootId, options.codeVersion ?? this.current.id, fn, options);
  }

  joinRoot<T>(
    rootId: string,
    codeVersionId: number,
    fn: (ctx: typesModule.Ctx) => T | Promise<T>,
    options: hostRootsTypes.JoinOptions = {},
  ): Promise<T> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const codeVersion = this.codeVersions.get(codeVersionId);
        if (codeVersion === undefined) {
          this.#local.delete(rootId);
          throw new ChordError(
            "superseded",
            `code version ${codeVersionId} is not retained by ${this.name}`,
          );
        }
        if (options.from !== undefined && !this.#local.has(rootId))
          linksOf(this.#foreign, rootId).add(options.from);
        codeVersion.roots.set(rootId, (codeVersion.roots.get(rootId) ?? 0) + 1);
        const ctx = new CtxImpl(this, {
          codeVersion: codeVersion.id,
          principal: options.principal ?? this.principal,
          rootId,
          signals:
            options.signal === undefined
              ? [codeVersion.abort.signal]
              : [options.signal, codeVersion.abort.signal],
        });
        return Effect.promise(() => Promise.resolve(fn(ctx))).pipe(
          Effect.ensuring(Effect.sync(() => this.#leave(rootId, codeVersion, ctx))),
        );
      }),
    );
  }

  #leave(
    rootId: string,
    codeVersion: hostTypesModule.CodeVersionState,
    ctx: ctxTypes.CtxImpl,
  ): void {
    ctx.close();
    const count = (codeVersion.roots.get(rootId) ?? 1) - 1;
    if (count > 0) {
      codeVersion.roots.set(rootId, count);
      return;
    }
    codeVersion.roots.delete(rootId);
    if (!this.#foreign.has(rootId)) this.endRoot(rootId);
    this.maybeRetire();
    this.#retirementChanged();
  }

  touch(rootId: string, object: objectTypes.ObjectImpl): void {
    let touched = this.#touches.get(rootId);
    if (touched === undefined) {
      touched = new Set();
      this.#touches.set(rootId, touched);
    }
    touched.add(object);
  }

  rootSent(rootId: string, connection: connectionTypes.Connection): void {
    linksOf(this.#rootLinks, rootId).add(connection);
  }

  endRoot(rootId: string): void {
    this.#local.delete(rootId);
    this.#foreign.delete(rootId);
    for (const object of this.#touches.get(rootId) ?? []) object.rootEnded(rootId);
    this.#touches.delete(rootId);
    for (const connection of this.#rootLinks.get(rootId) ?? [])
      connection.send({ rootId, t: "root_end" });
    this.#rootLinks.delete(rootId);
  }

  foreignRootEnded(rootId: string, from: connectionTypes.Connection): void {
    const links = this.#foreign.get(rootId);
    if (links === undefined || !links.delete(from) || links.size > 0) return;
    const running = [...this.codeVersions.values()].some((codeVersion) =>
      codeVersion.roots.has(rootId),
    );
    if (running) this.#foreign.delete(rootId);
    else this.endRoot(rootId);
  }

  protected rootsClosed(connection: connectionTypes.Connection): void {
    for (const [rootId, links] of [...this.#foreign])
      if (links.has(connection)) this.foreignRootEnded(rootId, connection);
    for (const links of this.#rootLinks.values()) links.delete(connection);
  }

  maybeRetire(): void {
    if (this.retirable()) this.retire();
  }

  retirable(): boolean {
    const previous = this.previous;
    if (previous === undefined || previous.roots.size > 0) return false;
    return (
      this.kind === "client" || this.upstream === undefined || previous.id <= this.#retireAllowed
    );
  }

  allowRetire(codeVersion: number): void {
    this.#retireAllowed = Math.max(this.#retireAllowed, codeVersion);
    this.maybeRetire();
    this.#retirementChanged();
  }

  watchRetirement(watcher: () => void): () => void {
    this.#retirementWatchers.add(watcher);
    return () => this.#retirementWatchers.delete(watcher);
  }

  #retirementChanged(): void {
    for (const watcher of [...this.#retirementWatchers]) watcher();
  }

  announceRetired(connection: connectionTypes.Connection): void {
    const retired = (this.previous ?? this.current).id - 1;
    if (retired > 0) connection.send({ codeVersion: retired, t: "retire" });
  }

  retire(): void {
    const previous = this.previous;
    if (previous === undefined) return;
    this.previous = undefined;
    this.codeVersions.delete(previous.id);
    for (const object of [...this.objects.values()]) this.retireImplementation(object, previous.id);
    for (const connection of this.connections) {
      if (connection.role === "downstream" && connection.peer.kind === "host")
        connection.send({ codeVersion: previous.id, t: "retire" });
    }
    this.#retirementChanged();
  }

  retireImplementation(object: objectTypes.ObjectImpl, codeVersion: number): void {
    const installed = object.implementations.get(codeVersion);
    object.implementations.delete(codeVersion);
    if (installed === undefined || installed.decls === object.decls) return;
    const kept = object.allDecls();
    const keep = <T>(pick: (decls: declsTypes.Decls) => Iterable<T>): Set<T> =>
      new Set([...kept].flatMap((decls) => Array.from(pick(decls))));
    const refs = keep((decls) => decls.refs.values());
    const resources = keep((decls) => decls.resources.values());
    const derives = keep((decls) => decls.derives.values());
    for (const derived of installed.decls.derives.values())
      if (!derives.has(derived)) derived.detach();
    const order = object.activation.openOrder;
    const closing = [...installed.decls.resources.values()]
      .filter((resource) => !resources.has(resource))
      .sort((a, b) => order.indexOf(b) - order.indexOf(a));
    const releasing: coreTypes.RefCore[] = [...installed.decls.refs.values()].filter(
      (ref) => !refs.has(ref),
    );
    object.lifecycle.refreshSchemas();
    Effect.runFork(
      runAll(
        [
          ...closing.map((resource) => resource.close(order)),
          ...releasing.map((ref) => Effect.sync(() => ref.release())),
        ],
        `${object.address}: retiring code version ${codeVersion} failed`,
      ).pipe(Effect.catchCause((cause) => Effect.sync(() => this.report(Cause.squash(cause))))),
    );
  }
}

const linksOf = <K, V>(map: Map<K, Set<V>>, key: K): Set<V> => {
  let links = map.get(key);
  if (links === undefined) {
    links = new Set();
    map.set(key, links);
  }
  return links;
};
