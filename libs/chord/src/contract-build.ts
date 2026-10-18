import { dual } from "effect/Function";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

import {
  type AnyContract,
  type Description,
  type LocalContract,
  type LocalDef,
  LOCAL_VARIANT,
  MEMBER,
  type MethodSpec,
  type OpaqueSpec,
  type Placement,
  type MemberDescription,
  type PlacementFor,
  PlacementSchema,
  type RemoteContract,
  type RemoteDef,
  RESERVED_MEMBERS,
} from "./contract.ts";
import { ChordError } from "./errors.ts";
import { canonicalJson, hash64 } from "./schema.ts";

function describeMember(
  name: string,
  member: unknown,
  scope: "remote" | "local",
): MemberDescription {
  if (RESERVED_MEMBERS.has(name)) throw new TypeError(`member name is reserved: ${name}`);
  const brand = (member as { [MEMBER]?: string })[MEMBER];
  if (brand === "method") {
    const spec = member as MethodSpec;
    return {
      kind: "method",
      ...(spec.args === undefined ? {} : { args: spec.args }),
      ...(spec.result === undefined ? {} : { result: spec.result }),
    };
  }
  if (brand === "opaque") {
    if (scope === "remote")
      throw new TypeError(`remote contracts cannot expose opaque members: ${name}`);
    return { kind: "opaque", id: (member as OpaqueSpec).id };
  }
  return { kind: "state", schema: member as TSchema };
}

function finish<C extends AnyContract>(contract: Omit<C, "fingerprint">): C {
  return { ...contract, fingerprint: hash64(canonicalJson(contract.description)) } as C;
}

function checkHeader(name: string, version: number): void {
  if (typeof name !== "string" || name === "") throw new TypeError("contract name is empty");
  if (!Number.isInteger(version) || version < 1)
    throw new TypeError(`contract version must be a positive integer`);
}

function remoteContract<const D extends RemoteDef>(
  name: string,
  def: D & { readonly host: PlacementFor<Static<D["input"]>> },
): RemoteContract<D> {
  checkHeader(name, def.version);
  const placement = def.host as Placement | undefined;
  if (placement === undefined || !Value.Check(PlacementSchema, placement))
    throw new TypeError(`remote contract ${name} needs \`host\`: hostNamed(…) or hostFamily(…)`);
  const host: Placement =
    "name" in placement
      ? { name: placement.name }
      : { prefix: placement.prefix, key: placement.key };
  const variants: Record<string, Record<string, MemberDescription>> = {};
  if (Object.keys(def.variants).length === 0)
    throw new TypeError(`remote contract ${name} has no variants`);
  for (const [kind, variant] of Object.entries(def.variants)) {
    const members: Record<string, MemberDescription> = {};
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
  const description: Description = {
    name,
    scope: "remote",
    version: def.version,
    input: def.input,
    host,
    variants,
  };
  return finish<RemoteContract<D>>({
    scope: "remote",
    name,
    version: def.version,
    input: def.input,
    def,
    description,
  });
}

function localContract<const D extends LocalDef>(name: string, def: D): LocalContract<D> {
  checkHeader(name, def.version);
  const members: Record<string, MemberDescription> = {};
  for (const [key, member] of Object.entries(def.members ?? {}))
    members[key] = describeMember(key, member, "local");
  const description: Description = {
    name,
    scope: "local",
    version: def.version,
    input: def.input,
    variants: { [LOCAL_VARIANT]: members },
  };
  return finish<LocalContract<D>>({
    scope: "local",
    name,
    version: def.version,
    input: def.input,
    def,
    description,
  });
}

export function contractFromDescription(description: Description): AnyContract {
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
    name,
    version,
    input,
    description,
    fingerprint: hash64(canonicalJson(description)),
  };
  return scope === "remote"
    ? { ...base, scope, def: { version, input, host: host!, variants: {} } }
    : { ...base, scope, def: { version, input } };
}

export const remote: {
  <const D extends RemoteDef>(
    def: D & { readonly host: PlacementFor<Static<D["input"]>> },
  ): (name: string) => RemoteContract<D>;
  <const D extends RemoteDef>(
    name: string,
    def: D & { readonly host: PlacementFor<Static<D["input"]>> },
  ): RemoteContract<D>;
} = dual(2, remoteContract);

export const local: {
  <const D extends LocalDef>(def: D): (name: string) => LocalContract<D>;
  <const D extends LocalDef>(name: string, def: D): LocalContract<D>;
} = dual(2, localContract);
