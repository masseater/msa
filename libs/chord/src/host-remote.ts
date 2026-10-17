import { Cause, Effect } from "effect";

import type { Connection, RelayRef } from "./connection.ts";
import { type AnyContract, contractFromDescription, resolveHost } from "./contract.ts";
import type { RefCore, RefOwner } from "./core.ts";
import { ChordError, invalid } from "./errors.ts";
import { HostObjects } from "./host-objects.ts";
import type { Route } from "./host-types.ts";
import { RemoteBinding, RemoteRef } from "./remote-ref.ts";
import type { GetOptions } from "./types.ts";

export abstract class HostRemote extends HostObjects {
  readonly bindings = new Map<string, RemoteBinding>();
  readonly #lingering = new Map<string, RemoteBinding>();
  readonly #routes = new Map<string, Route>();

  protected abstract addConnection(
    link: Awaited<ReturnType<Route["resolve"]>>,
    config: ConstructorParameters<typeof Connection>[2],
  ): Connection;

  bindingIdle(binding: RemoteBinding): void {
    const types = this.options.linger?.types ?? {};
    const cap = this.options.linger?.cap ?? 4;
    const ms = Object.hasOwn(types, binding.contract.name) ? types[binding.contract.name]! : 0;
    if (ms <= 0 || binding.ended || !binding.applied || cap <= 0) {
      binding.close();
      return;
    }
    binding.lingerTimer = this.timers.after(ms, () => binding.close());
    this.#lingering.set(binding.key, binding);
    for (const oldest of this.#lingering.values()) {
      if (this.#lingering.size <= cap) break;
      oldest.close();
    }
  }

  forgetBinding(binding: RemoteBinding): void {
    if (this.bindings.get(binding.key) === binding) this.bindings.delete(binding.key);
    if (this.#lingering.get(binding.key) === binding) this.#lingering.delete(binding.key);
  }

  protected closeLingering(): void {
    for (const binding of [...this.#lingering.values()]) binding.close();
  }

  route(prefix: string, route: Route): void {
    if (typeof route.principal !== "function")
      throw new TypeError(
        `route ${prefix} needs \`principal\`: what the routed hosts act as when they call back`,
      );
    this.#routes.set(prefix, route);
  }

  #childNamed(name: string): Connection | undefined {
    return [...this.connections].find(
      (connection) =>
        connection.open &&
        connection.role === "downstream" &&
        connection.peer.kind === "host" &&
        connection.peer.name === name,
    );
  }

  protected acquireRemote(
    type: AnyContract,
    at: string,
    input: unknown,
    options: GetOptions | undefined,
    owner: RefOwner,
  ): RefCore {
    const principal =
      options?.principal === undefined || this.isSelf(options.principal)
        ? undefined
        : options.principal;
    const key = this.remoteKey(type, input, principal ?? this.principal);
    let binding = this.bindings.get(key);
    const fresh = binding === undefined || binding.ended;
    if (binding === undefined || binding.ended) {
      binding = new RemoteBinding(this, { key, contract: type, at, input, principal });
      this.bindings.set(key, binding);
    }
    const ref = new RemoteRef(binding, owner, options?.state !== false);
    this.#lingering.delete(key);
    binding.addView(ref);
    if (fresh) this.#hold(binding);
    return ref;
  }

  #hold(binding: RemoteBinding): void {
    const bindWhenSynced = (connection: Effect.Effect<Connection>): void => {
      Effect.runFork(
        connection.pipe(
          Effect.matchCause({
            onSuccess: (target) => {
              if (!binding.ended && binding.hold === undefined) target.hold(binding, false);
            },
            onFailure: (cause) => binding.gone(Cause.squash(cause)),
          }),
        ),
      );
    };
    const direct = this.#childNamed(binding.at);
    if (this.upstream !== undefined) {
      this.upstream.hold(binding, false);
      return;
    }
    if (direct !== undefined) {
      bindWhenSynced(direct.whenSynced().pipe(Effect.as(direct)));
      return;
    }
    const route = this.#routeFor(binding.at);
    if (route === undefined)
      binding.gone(new ChordError("unavailable", `no route to ${binding.at}`));
    else bindWhenSynced(this.#resolve(route, binding.at, binding.principal ?? this.principal));
  }

  #routeFor(hostName: string): Route | undefined {
    let best: [string, Route] | undefined;
    for (const entry of this.#routes) {
      if (hostName.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length))
        best = entry;
    }
    return best?.[1];
  }

  #resolve(
    route: Route,
    hostName: string,
    principal: unknown,
    still: () => boolean = () => true,
  ): Effect.Effect<Connection> {
    const refuse = (): ChordError =>
      new ChordError("forbidden", `${hostName} refused for this principal`);
    const revoked = (): ChordError =>
      new ChordError("gone", "principal invalidated while resolving");
    const authorized = Effect.promise(() => Promise.resolve(route.authorize(principal, hostName)));
    return Effect.gen({ self: this }, function* () {
      if (!(yield* authorized)) throw refuse();
      if (!still()) throw revoked();
      const link = yield* Effect.promise(() => route.resolve(hostName));
      if (!still()) throw revoked();
      if (!(yield* authorized)) throw refuse();
      if (!still()) throw revoked();
      let connection = [...this.connections].find((candidate) => candidate.link === link);
      connection ??= this.addConnection(link, {
        role: "downstream",
        principal: route.principal(hostName),
        peer: { kind: "host", name: hostName },
      });
      yield* connection.whenSynced();
      if (!still()) throw revoked();
      return connection;
    });
  }

  relay(relay: RelayRef): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const at = relay.frame.at;
      const placement = contractFromDescription(relay.frame.token).description.host;
      if (
        placement === undefined ||
        resolveHost(relay.frame.token.name, placement, relay.frame.input) !== at
      )
        throw invalid(
          "placement",
          `${relay.frame.token.name} with this input does not live on ${at}`,
        );
      const route = this.#routeFor(at);
      if (route === undefined) {
        throw this.#childNamed(at) === undefined
          ? new ChordError("unavailable", `no route to ${at}`)
          : new ChordError("forbidden", `no route authorizes ${at}`);
      }
      const down = yield* this.#resolve(route, at, relay.principal, () => relay.current);
      if (!relay.current) return;
      relay.open(down);
    });
  }
}
