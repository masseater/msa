import type contractTypes from "./contract.types.ts";
import type coreTypes from "./core.types.ts";
import type errorsTypes from "./errors.types.ts";
import hostObjectsKit from "./host-objects-kit.ts";
import type objectTypes from "./object.types.ts";
import RefImpl from "./ref.ts";
import schemaModule from "./schema.ts";
import serviceModule from "./service.ts";
import type serviceTypes from "./service.types.ts";
import type typesModule from "./types.types.ts";

const {
  contract: contractModule,
  errors: errorsModule,
  HostRegistries,
  ObjectImpl,
} = hostObjectsKit;

const { ChordError, invalid } = errorsModule;
const { canonicalIdentity, normalize } = schemaModule;
const { bind, resolveHost } = contractModule;
const { hostLifetime } = serviceModule;

interface Located {
  readonly address: string;
  readonly normalized: unknown;
  readonly principal: unknown;
}

const unknownType = (type: string, host: string): errorsTypes.ChordError =>
  new ChordError("unavailable", `${type} is not served by ${host}`, { reason: "unknown_type" });

const reaches = (from: objectTypes.ObjectImpl, to: objectTypes.ObjectImpl): boolean => {
  const seen = new Set<objectTypes.ObjectImpl>();
  const stack = [from];
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object === to) return true;
    if (seen.has(object)) continue;
    seen.add(object);
    for (const decls of object.allDecls()) {
      for (const ref of decls.refs.values()) if (ref.object !== undefined) stack.push(ref.object);
    }
  }
  return false;
};

export default abstract class HostObjects extends HostRegistries {
  readonly #dying = new Map<string, objectTypes.ObjectImpl>();

  protected abstract acquireRemote(
    type: contractTypes.AnyContract,
    at: string,
    input: unknown,
    options: typesModule.GetOptions | undefined,
    owner: coreTypes.RefOwner,
  ): coreTypes.RefCore;

  addressOf(
    type: contractTypes.AnyContract,
    input: unknown,
    principal: unknown,
    candidate = false,
  ): string {
    const elsewhere = this.#elsewhere(type, input);
    if (elsewhere !== undefined) return this.remoteKey(type, elsewhere.input, principal);
    const service = this.#bindingService(type.name, candidate);
    if (service === undefined) throw unknownType(type.name, this.name);
    return this.#locate(service, input, principal).address;
  }

  #elsewhere(
    type: contractTypes.AnyContract,
    input: unknown,
  ): { readonly at: string; readonly input: unknown } | undefined {
    const placement = type.description.host;
    if (type.scope !== "remote" || placement === undefined) return undefined;
    const normalized = normalize(type.input, input, `${type.name} input`);
    const at = resolveHost(type.name, placement, normalized);
    return at === this.name ? undefined : { at, input: normalized };
  }

  #locate(service: serviceTypes.Service, input: unknown, principal: unknown): Located {
    const { name, input: schema } = service.contract;
    const normalized = normalize(schema, input, `${name} input`);
    const identity = canonicalIdentity(schema, normalized);
    let owner = principal;
    if (hostLifetime(service)) {
      if (identity !== canonicalIdentity(schema, normalize(schema, {}, `${name} input`)))
        throw invalid("input", `${name} has lifetime "host": its one object has the empty input`);
      owner = this.principal;
    }
    return {
      address: `${name}\u0000${identity}\u0000${this.principalPart(owner)}`,
      normalized,
      principal: owner,
    };
  }

  protected remoteKey(
    type: contractTypes.AnyContract,
    normalized: unknown,
    principal: unknown,
  ): string {
    const identity = canonicalIdentity(type.input, normalized);
    return `@${type.name}\u0000${identity}\u0000${this.principalPart(principal)}\u0000${type.fingerprint}`;
  }

  #bindingService(typeName: string, candidate: boolean): serviceTypes.Service | undefined {
    return (candidate ? this.pending?.services.get(typeName) : undefined) ?? this.service(typeName);
  }

  acquire(
    type: contractTypes.AnyContract,
    input: unknown,
    options: typesModule.GetOptions | undefined,
    owner: coreTypes.RefOwner,
    from?: objectTypes.ObjectImpl,
    candidate = false,
  ): coreTypes.RefCore {
    const elsewhere = this.#elsewhere(type, input);
    if (elsewhere !== undefined)
      return this.acquireRemote(type, elsewhere.at, elsewhere.input, options, owner);
    const service = this.#bindingService(type.name, candidate);
    if (service === undefined) throw unknownType(type.name, this.name);
    bind(service.contract, service.options.accepts, type);
    const located = this.#locate(service, input, options?.principal ?? this.principal);
    const placement = service.contract.description.host;
    if (
      placement !== undefined &&
      resolveHost(type.name, placement, located.normalized) !== this.name
    ) {
      throw invalid(
        "placement",
        `${type.name} with this input lives on ${resolveHost(type.name, placement, located.normalized)}, not ${this.name}`,
      );
    }
    const object = this.#objectAt(type, service, located, from);
    const ref = new RefImpl(object, type, owner);
    object.addRef(ref);
    return ref;
  }

  #objectAt(
    type: contractTypes.AnyContract,
    service: serviceTypes.Service,
    located: Located,
    from: objectTypes.ObjectImpl | undefined,
  ): objectTypes.ObjectImpl {
    const { address } = located;
    const existing = this.objects.get(address);
    if (
      from !== undefined &&
      existing !== undefined &&
      (existing === from || reaches(existing, from))
    )
      throw invalid("cycle", `${from.address} -> ${address} would create a ref cycle`);
    if (existing !== undefined) return existing;
    if (this.gating?.has(type.name) === true) {
      throw new ChordError("upgrade_conflict", `${type.name} is being upgraded; retry`, {
        reason: "gate",
      });
    }
    const dying = this.#dying.get(address);
    if (dying?.status === "disposed") this.#dying.delete(address);
    const object = new ObjectImpl(this, {
      address,
      hostLifetime: hostLifetime(service),
      input: located.normalized,
      principal: located.principal,
      typeName: type.name,
    });
    this.objects.set(address, object);
    object.start(dying?.status === "disposing" ? dying.dispose(false) : undefined);
    return object;
  }

  forget(object: objectTypes.ObjectImpl): void {
    if (this.objects.get(object.address) === object) this.objects.delete(object.address);
    if (object.status === "disposing") this.#dying.set(object.address, object);
  }

  disposed(object: objectTypes.ObjectImpl): void {
    if (this.#dying.get(object.address) === object) this.#dying.delete(object.address);
  }

  hold<C extends contractTypes.AnyContract>(
    type: C,
    input: contractTypes.InputOf<C>,
    options?: typesModule.GetOptions,
  ): contractTypes.Ref<C> {
    return this.acquire(type, input, options, "external").proxy as contractTypes.Ref<C>;
  }

  startHostObject(service: serviceTypes.Service): coreTypes.RefCore {
    const ref = this.acquire(service.contract, {}, undefined, "host");
    this.hostObjects.set(service.contract.name, ref);
    ref.ready.catch((error: unknown) => this.report(error));
    return ref;
  }
}
