import { dual } from "effect/Function";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

import contractModule from "./contract.ts";
import type contractTypes from "./contract.types.ts";
import errorsModule from "./errors.ts";
import schemaModule from "./schema.ts";
const { canonicalJson, hash64 } = schemaModule;
const { ChordError } = errorsModule;

function describeMember(
  name: string,
  member: unknown,
  scope: "remote" | "local",
): contractTypes.MemberDescription {
  if (contractModule.RESERVED_MEMBERS.has(name))
    throw new TypeError(`member name is reserved: ${name}`);
  const brand = (member as { [contractModule.MEMBER]?: string })[contractModule.MEMBER];
  if (brand === "method") {
    const spec = member as contractTypes.MethodSpec;
    return {
      kind: "method",
      ...(spec.args === undefined ? {} : { args: spec.args }),
      ...(spec.result === undefined ? {} : { result: spec.result }),
    };
  }
  if (brand === "opaque") {
    if (scope === "remote")
      throw new TypeError(`remote contracts cannot expose opaque members: ${name}`);
    return { id: (member as contractTypes.OpaqueSpec).id, kind: "opaque" };
  }
  return { kind: "state", schema: member as TSchema };
}

function finish<C extends contractTypes.AnyContract>(contract: Omit<C, "fingerprint">): C {
  return { ...contract, fingerprint: hash64(canonicalJson(contract.description)) } as C;
}

function checkHeader(name: string, version: number): void {
  if (typeof name !== "string" || name === "") throw new TypeError("contract name is empty");
  if (!Number.isInteger(version) || version < 1)
    throw new TypeError(`contract version must be a positive integer`);
}

function remoteContract<const D extends contractTypes.RemoteDef>(
  name: string,
  def: D & { readonly host: contractTypes.PlacementFor<Static<D["input"]>> },
): contractTypes.RemoteContract<D> {
  checkHeader(name, def.version);
  const placement = def.host as contractTypes.Placement | undefined;
  if (placement === undefined || !Value.Check(contractModule.PlacementSchema, placement))
    throw new TypeError(`remote contract ${name} needs \`host\`: hostNamed(…) or hostFamily(…)`);
  const host: contractTypes.Placement =
    "name" in placement
      ? { name: placement.name }
      : { key: placement.key, prefix: placement.prefix };
  const variants: Record<string, Record<string, contractTypes.MemberDescription>> = {};
  if (Object.keys(def.variants).length === 0)
    throw new TypeError(`remote contract ${name} has no variants`);
  for (const [kind, variant] of Object.entries(def.variants)) {
    const members: Record<string, contractTypes.MemberDescription> = {};
    for (const [key, schema] of Object.entries(variant.state ?? {}))
      members[key] = describeMember(key, schema, "remote");
    for (const [key, spec] of Object.entries(variant.methods ?? {})) {
      if (key in members)
        throw new TypeError(`member ${key} is both state and method in ${name}.${kind}`);
      members[key] = describeMember(key, spec, "remote");
      if (members[key].kind !== "method") throw new TypeError(`methods.${key} is not a method()`);
    }
    variants[kind] = members;
  }
  const description: contractTypes.Description = {
    host,
    input: def.input,
    name,
    scope: "remote",
    variants,
    version: def.version,
  };
  return finish<contractTypes.RemoteContract<D>>({
    def,
    description,
    input: def.input,
    name,
    scope: "remote",
    version: def.version,
  });
}

function localContract<const D extends contractTypes.LocalDef>(
  name: string,
  def: D,
): contractTypes.LocalContract<D> {
  checkHeader(name, def.version);
  const members: Record<string, contractTypes.MemberDescription> = {};
  for (const [key, member] of Object.entries(def.members ?? {}))
    members[key] = describeMember(key, member, "local");
  const description: contractTypes.Description = {
    input: def.input,
    name,
    scope: "local",
    variants: { [contractModule.LOCAL_VARIANT]: members },
    version: def.version,
  };
  return finish<contractTypes.LocalContract<D>>({
    def,
    description,
    input: def.input,
    name,
    scope: "local",
    version: def.version,
  });
}

function contractFromDescription(
  description: contractTypes.Description,
): contractTypes.AnyContract {
  const { name, scope, version, input, host } = description;
  if (
    typeof name !== "string" ||
    (scope !== "remote" && scope !== "local") ||
    !Number.isInteger(version) ||
    (scope === "remote") !== (host !== undefined)
  ) {
    throw new ChordError("invalid", "malformed contract token", { reason: "token" });
  }
  const base = {
    description,
    fingerprint: hash64(canonicalJson(description)),
    input,
    name,
    version,
  };
  return scope === "remote"
    ? { ...base, def: { host: host!, input, variants: {}, version }, scope }
    : { ...base, def: { input, version }, scope };
}

const remote: {
  <const D extends contractTypes.RemoteDef>(
    def: D & { readonly host: contractTypes.PlacementFor<Static<D["input"]>> },
  ): (name: string) => contractTypes.RemoteContract<D>;
  <const D extends contractTypes.RemoteDef>(
    name: string,
    def: D & { readonly host: contractTypes.PlacementFor<Static<D["input"]>> },
  ): contractTypes.RemoteContract<D>;
} = dual(2, remoteContract);

const local: {
  <const D extends contractTypes.LocalDef>(
    def: D,
  ): (name: string) => contractTypes.LocalContract<D>;
  <const D extends contractTypes.LocalDef>(name: string, def: D): contractTypes.LocalContract<D>;
} = dual(2, localContract);

const contractBuild = {
  contractFromDescription,
  local,
  remote,
};

export default contractBuild;
