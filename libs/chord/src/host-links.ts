import { Cause, Effect } from "effect";

import { ChildReloads } from "./child-reloads.ts";
import { reconcileChild } from "./cluster.ts";
import { type AcceptOptions, Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import { disposeHoldersFirst, matchesPattern } from "./host-dispose.ts";
import { HostFacets } from "./host-facets.ts";
import type { ConnectOptions, PrincipalMatch } from "./host-types.ts";
import type { Link } from "./link.ts";
import type { Frame } from "./wire.ts";

export abstract class HostLinks extends HostFacets {
  readonly #childReloads = new ChildReloads(this);
  readonly #deferredHellos = new Map<Connection, number>();
  readonly #reloadWaiters: (() => void)[] = [];
  #originSeq = 0;

  accept(link: Link, options: AcceptOptions): void {
    const kind = options.kind ?? "client";
    if (kind === "host" && options.name === undefined)
      throw new TypeError("accepting a host link needs its name");
    if (kind === "client") this.#originSeq += 1;
    this.addConnection(link, {
      ...options,
      role: "downstream",
      principal: options.principal,
      peer: { kind, name: kind === "host" ? options.name : undefined },
      ...(kind === "client" ? { originId: `${this.incarnation}:${this.#originSeq}` } : {}),
    });
  }

  connect(link: Link, options: ConnectOptions): void {
    if (!("principal" in options))
      throw new TypeError("connect needs `principal`: what the parent's own requests act as");
    if (this.upstream?.open === true) this.upstream.link.close("replaced");
    const connection = this.addConnection(link, {
      ...options,
      role: "upstream",
      principal: options.principal,
      peer: { kind: "host", name: undefined },
    });
    this.upstream = connection;
    for (const binding of this.bindings.values())
      if (binding.hold === undefined && !binding.ended) connection.hold(binding, binding.applied);
  }

  protected addConnection(
    link: Link,
    config: ConstructorParameters<typeof Connection>[2],
  ): Connection {
    const connection = new Connection(this, link, config);
    if (connection.open) this.connections.add(connection);
    return connection;
  }

  peerHello(connection: Connection, codeVersion: number): void {
    if (codeVersion > this.current.id) {
      this.report(
        new ChordError(
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

  connectionClosed(connection: Connection): void {
    this.connections.delete(connection);
    this.#deferredHellos.delete(connection);
    this.rootsClosed(connection);
    if (this.upstream === connection) {
      this.upstream = undefined;
      this.#childReloads.parentLost();
    }
  }

  onReloadFrame(
    connection: Connection,
    frame: Extract<Frame, { t: "prepare" | "commit" | "abort" }>,
  ): void {
    this.#childReloads.handle(connection, frame);
  }

  invalidatePrincipal(match: PrincipalMatch): Promise<void> {
    return Effect.runPromise(Effect.suspend(() => this.#invalidate(match)));
  }

  #invalidate(match: PrincipalMatch): Effect.Effect<void> {
    const matches =
      typeof match === "function"
        ? match
        : (principal: unknown) => matchesPattern(match, principal);
    const reason = new ChordError("gone", "principal invalidated");
    for (const connection of [...this.connections]) {
      if (connection.role !== "downstream" || !matches(connection.principal)) continue;
      connection.revoke(connection.restamp?.(connection.principal));
    }
    if (typeof match !== "function") {
      for (const connection of this.connections) {
        if (connection.role === "downstream" && connection.peer.kind === "host") {
          connection.send({ t: "invalidate", pattern: match });
        }
      }
    }
    const objects = [...this.objects.values()].filter(
      (object) => !this.isSelf(object.principal) && matches(object.principal),
    );
    return disposeHoldersFirst({
      objects,
      reason,
      message: "invalidatePrincipal: disposal failed",
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
