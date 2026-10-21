import { Cause, Effect } from "effect";

import type connectionModule from "./connection.ts";
import type connectionTypes from "./connection.types.ts";
import type contractTypes from "./contract.types.ts";
import type coreTypes from "./core.types.ts";
import type errorsTypes from "./errors.types.ts";
import hostRemoteKit from "./host-remote-kit.ts";
import type hostTypesModule from "./host-types.types.ts";
import type remoteRefTypes from "./remote-ref.types.ts";
import type typesModule from "./types.types.ts";

const { contract: contractModule, errors: errorsModule, remoteRef } = hostRemoteKit;

const { RemoteBinding, RemoteRef } = remoteRef;
const { ChordError, invalid } = errorsModule;
const { contractFromDescription, resolveHost } = contractModule;

export default abstract class HostRemote extends hostRemoteKit.HostObjects {
  readonly bindings = new Map<string, remoteRefTypes.RemoteBinding>();
  readonly #lingering = new Map<string, remoteRefTypes.RemoteBinding>();
  readonly #routes = new Map<string, hostTypesModule.Route>();

  protected abstract addConnection(
    link: Awaited<ReturnType<hostTypesModule.Route["resolve"]>>,
    config: ConstructorParameters<typeof connectionModule.Connection>[2],
  ): connectionTypes.Connection;

  bindingIdle(binding: remoteRefTypes.RemoteBinding): void {
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

  forgetBinding(binding: remoteRefTypes.RemoteBinding): void {
    if (this.bindings.get(binding.key) === binding) this.bindings.delete(binding.key);
    if (this.#lingering.get(binding.key) === binding) this.#lingering.delete(binding.key);
  }

  protected closeLingering(): void {
    for (const binding of [...this.#lingering.values()]) binding.close();
  }

  route(prefix: string, route: hostTypesModule.Route): void {
    if (typeof route.principal !== "function")
      throw new TypeError(
        `route ${prefix} needs \`principal\`: what the routed hosts act as when they call back`,
      );
    this.#routes.set(prefix, route);
  }

  #childNamed(name: string): connectionTypes.Connection | undefined {
    return [...this.connections].find(
      (connection) =>
        connection.open &&
        connection.role === "downstream" &&
        connection.peer.kind === "host" &&
        connection.peer.name === name,
    );
  }

  protected acquireRemote(
    type: contractTypes.AnyContract,
    at: string,
    input: unknown,
    options: typesModule.GetOptions | undefined,
    owner: coreTypes.RefOwner,
  ): coreTypes.RefCore {
    const principal =
      options?.principal === undefined || this.isSelf(options.principal)
        ? undefined
        : options.principal;
    const key = this.remoteKey(type, input, principal ?? this.principal);
    let binding = this.bindings.get(key);
    const fresh = binding === undefined || binding.ended;
    if (binding === undefined || binding.ended) {
      binding = new RemoteBinding(this, { at, contract: type, input, key, principal });
      this.bindings.set(key, binding);
    }
    const ref = new RemoteRef(binding, owner, options?.state !== false);
    this.#lingering.delete(key);
    binding.addView(ref);
    if (fresh) this.#hold(binding);
    return ref;
  }

  #hold(binding: remoteRefTypes.RemoteBinding): void {
    const bindWhenSynced = (connection: Effect.Effect<connectionTypes.Connection>): void => {
      Effect.runFork(
        connection.pipe(
          Effect.matchCause({
            onFailure: (cause) => binding.gone(Cause.squash(cause)),
            onSuccess: (target) => {
              if (!binding.ended && binding.hold === undefined) target.hold(binding, false);
            },
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

  #routeFor(hostName: string): hostTypesModule.Route | undefined {
    let best: [string, hostTypesModule.Route] | undefined;
    for (const entry of this.#routes) {
      if (hostName.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length))
        best = entry;
    }
    return best?.[1];
  }

  #resolve(
    route: hostTypesModule.Route,
    hostName: string,
    principal: unknown,
    still: () => boolean = () => true,
  ): Effect.Effect<connectionTypes.Connection> {
    const refuse = (): errorsTypes.ChordError =>
      new ChordError("forbidden", `${hostName} refused for this principal`);
    const revoked = (): errorsTypes.ChordError =>
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
        peer: { kind: "host", name: hostName },
        principal: route.principal(hostName),
        role: "downstream",
      });
      yield* connection.whenSynced();
      if (!still()) throw revoked();
      return connection;
    });
  }

  relay(relay: connectionTypes.RelayRef): Effect.Effect<void> {
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
