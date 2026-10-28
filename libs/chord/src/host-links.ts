import { Cause, Effect } from "effect";

import connectionModule from "./connection.ts";
import type connectionTypes from "./connection.types.ts";
import errorsModule from "./errors.ts";
import hostDispose from "./host-dispose.ts";
import HostFacets from "./host-facets.ts";
import hostLinksKit from "./host-links-kit.ts";
import type hostTypesModule from "./host-types.types.ts";
import type linkTypes from "./link.types.ts";
import type wireTypes from "./wire.types.ts";

const { ChildReloads, cluster } = hostLinksKit;

const { Connection } = connectionModule;
const { ChordError } = errorsModule;
const { reconcileChild } = cluster;
const { disposeHoldersFirst, matchesPattern } = hostDispose;

export default abstract class HostLinks extends HostFacets {
  readonly #childReloads = new ChildReloads(this);
  readonly #deferredHellos = new Map<connectionTypes.Connection, number>();
  readonly #reloadWaiters: (() => void)[] = [];
  #originSeq = 0;

  accept(link: linkTypes.Link, options: connectionTypes.AcceptOptions): void {
    const kind = options.kind ?? "client";
    if (kind === "host" && options.name === undefined)
      throw new TypeError("accepting a host link needs its name");
    if (kind === "client") this.#originSeq += 1;
    this.addConnection(link, {
      ...options,
      peer: { kind, name: kind === "host" ? options.name : undefined },
      principal: options.principal,
      role: "downstream",
      ...(kind === "client" ? { originId: `${this.incarnation}:${this.#originSeq}` } : {}),
    });
  }

  connect(link: linkTypes.Link, options: hostTypesModule.ConnectOptions): void {
    if (!("principal" in options))
      throw new TypeError("connect needs `principal`: what the parent's own requests act as");
    if (this.upstream?.open === true) this.upstream.link.close("replaced");
    const connection = this.addConnection(link, {
      ...options,
      peer: { kind: "host", name: undefined },
      principal: options.principal,
      role: "upstream",
    });
    this.upstream = connection;
    for (const binding of this.bindings.values())
      if (binding.hold === undefined && !binding.ended) connection.hold(binding, binding.applied);
  }

  protected addConnection(
    link: linkTypes.Link,
    config: ConstructorParameters<typeof Connection>[2],
  ): connectionTypes.Connection {
    const connection = new Connection(this, link, config);
    if (connection.open) this.connections.add(connection);
    return connection;
  }

  peerHello(connection: connectionTypes.Connection, codeVersion: number): void {
    if (codeVersion > this.current.id) {
      this.report(
        ChordError.create(
          "invalid",
          `${connection.name} runs code version ${codeVersion}, ahead of ${this.current.id}`,
        ),
      );
      connection.link.close("code version ahead of parent");
      return;
    }
    if (this.reloading) {
      connection.peerCodeVersion = codeVersion;
      if (codeVersion < this.current.id) connection.fencedCodeVersions.add(codeVersion);
      this.#deferredHellos.set(connection, codeVersion);
      return;
    }
    if (codeVersion === this.current.id) {
      connection.markSynced(codeVersion);
      this.announceRetired(connection);
      return;
    }
    connection.peerCodeVersion = codeVersion;
    connection.fencedCodeVersions.add(codeVersion);
    Effect.runFork(
      reconcileChild(this, connection).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            this.report(Cause.squash(cause));
            connection.link.close("reconciliation failed");
          }),
        ),
      ),
    );
  }

  reloadEnded(): void {
    this.reloading = false;
    const deferred = [...this.#deferredHellos];
    this.#deferredHellos.clear();
    for (const [connection, codeVersion] of deferred)
      if (connection.open) this.peerHello(connection, codeVersion);
    for (const resolve of this.#reloadWaiters.splice(0)) resolve();
    this.maybeRetire();
  }

  whenReloadEnded(): Effect.Effect<void> {
    return Effect.suspend(() =>
      this.reloading
        ? Effect.callback<void>((resume) => {
            this.#reloadWaiters.push(() => resume(Effect.void));
          })
        : Effect.void,
    );
  }

  connectionClosed(connection: connectionTypes.Connection): void {
    this.connections.delete(connection);
    this.#deferredHellos.delete(connection);
    this.rootsClosed(connection);
    if (this.upstream === connection) {
      this.upstream = undefined;
      this.#childReloads.parentLost();
    }
  }

  onReloadFrame(
    connection: connectionTypes.Connection,
    frame: Extract<wireTypes.Frame, { t: "prepare" | "commit" | "abort" }>,
  ): void {
    this.#childReloads.handle(connection, frame);
  }

  invalidatePrincipal(match: hostTypesModule.PrincipalMatch): Promise<void> {
    return Effect.runPromise(Effect.suspend(() => this.#invalidate(match)));
  }

  #invalidate(match: hostTypesModule.PrincipalMatch): Effect.Effect<void> {
    const matches =
      typeof match === "function"
        ? match
        : (principal: unknown) => matchesPattern(match, principal);
    const reason = ChordError.create("gone", "principal invalidated");
    for (const connection of [...this.connections]) {
      if (connection.role !== "downstream" || !matches(connection.principal)) continue;
      connection.revoke(connection.restamp?.(connection.principal));
    }
    if (typeof match !== "function") {
      for (const connection of this.connections) {
        if (connection.role === "downstream" && connection.peer.kind === "host") {
          connection.send({ pattern: match, t: "invalidate" });
        }
      }
    }
    const objects = [...this.objects.values()].filter(
      (object) => !this.isSelf(object.principal) && matches(object.principal),
    );
    return disposeHoldersFirst({
      message: "invalidatePrincipal: disposal failed",
      objects,
      reason,
    });
  }

  rememberRemoteModules(
    remote: Readonly<Record<string, readonly string[]>> | undefined,
    remove: Readonly<Record<string, readonly string[]>> | undefined,
  ): void {
    for (const prefix of new Set([...Object.keys(remote ?? {}), ...Object.keys(remove ?? {})])) {
      const modules = remote?.[prefix] ?? [];
      const removed = remove?.[prefix] ?? [];
      this.remoteModules[prefix] = [
        ...new Set([...(this.remoteModules[prefix] ?? []), ...modules]),
      ].filter((module) => !removed.includes(module));
      this.remoteRemoved[prefix] = [
        ...new Set([...(this.remoteRemoved[prefix] ?? []), ...removed]),
      ].filter((module) => !modules.includes(module));
    }
  }
}
