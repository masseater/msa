import { dual } from "effect/Function";
import { type TSchema, Type } from "typebox";

import contractBuild from "./contract-build.ts";
import contractCompat from "./contract-compat.ts";
import type contractTypes from "./contract.types.ts";
import errorsModule from "./errors.ts";

const { invalid } = errorsModule;

const MEMBER: unique symbol = Symbol("chord.member");

function method(...input: []): contractTypes.MethodSpec<undefined, undefined>;
function method<A extends TSchema>(...input: [args: A]): contractTypes.MethodSpec<A, undefined>;
function method<A extends TSchema | undefined, R extends TSchema>(
  ...input: [args: A, result: R]
): contractTypes.MethodSpec<A, R>;
function method(...[args, result]: [args?: TSchema, result?: TSchema]): contractTypes.MethodSpec {
  return { [MEMBER]: "method", args, result };
}

const opaque = <T = unknown>(id: string): contractTypes.OpaqueSpec<T> => {
  if (!/^[^@\s]+@\d+$/u.test(id)) throw new TypeError(`opaque id must be name@version: ${id}`);
  return { [MEMBER]: "opaque", id };
};

function hostNamed(name: string): contractTypes.HostNamed {
  if (typeof name !== "string" || name === "") throw new TypeError("hostNamed needs a host name");
  return { name };
}

function familyOfHosts<const K extends string>(
  prefix: string,
  key: K,
): contractTypes.HostFamily<K> {
  if (typeof prefix !== "string" || prefix === "")
    throw new TypeError("hostFamily needs a host-name prefix");
  if (typeof key !== "string" || key === "")
    throw new TypeError("hostFamily needs an input field name");
  return { key, prefix };
}

function hostOf(typeName: string, placement: contractTypes.Placement, input: unknown): string {
  if ("name" in placement) return placement.name;
  const value =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)[placement.key]
      : undefined;
  if (typeof value !== "string" || value === "")
    throw invalid("placement", `${typeName}: input field ${placement.key} names no host`);
  return placement.prefix + value;
}

const placedOn: {
  (hostName: string): (placement: contractTypes.Placement) => boolean;
  (placement: contractTypes.Placement, hostName: string): boolean;
} = dual(2, (placement: contractTypes.Placement, hostName: string): boolean =>
  "name" in placement
    ? placement.name === hostName
    : hostName.startsWith(placement.prefix) && hostName.length > placement.prefix.length,
);

const placementText = (placement: contractTypes.Placement): string =>
  "name" in placement ? placement.name : `${placement.prefix}<${placement.key}>`;

const SchemaObject = Type.Unsafe<TSchema>(Type.Object({}));

const MemberDescriptionSchema = Type.Union([
  Type.Object({
    args: Type.Optional(SchemaObject),
    kind: Type.Literal("method"),
    result: Type.Optional(SchemaObject),
  }),
  Type.Object({ kind: Type.Literal("state"), schema: SchemaObject }),
  Type.Object({ id: Type.String(), kind: Type.Literal("opaque") }),
]);

const LOCAL_VARIANT = "";

const PlacementSchema = Type.Union([
  Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object(
    { key: Type.String({ minLength: 1 }), prefix: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

const DescriptionSchema = Type.Object({
  host: Type.Optional(PlacementSchema),
  input: SchemaObject,
  name: Type.String({ minLength: 1 }),
  scope: Type.Union([Type.Literal("remote"), Type.Literal("local")]),
  variants: Type.Record(Type.String(), Type.Record(Type.String(), MemberDescriptionSchema)),
  version: Type.Integer(),
});

const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
  "variant",
  "status",
  "ready",
  "shape",
  "error",
  "onShape",
  "onStatus",
  "release",
  "then",
  "contract",
]);

const hostFamily: {
  <const K extends string>(key: K): (prefix: string) => contractTypes.HostFamily<K>;
  <const K extends string>(prefix: string, key: K): contractTypes.HostFamily<K>;
} = dual(2, familyOfHosts);

const resolveHost: {
  (placement: contractTypes.Placement, input: unknown): (typeName: string) => string;
  (typeName: string, placement: contractTypes.Placement, input: unknown): string;
} = dual(3, hostOf);

const contract = {
  DescriptionSchema,
  LOCAL_VARIANT,
  MEMBER,
  MemberDescriptionSchema,
  PlacementSchema,
  RESERVED_MEMBERS,
  get bind() {
    return contractCompat.bind;
  },
  get contractFromDescription() {
    return contractBuild.contractFromDescription;
  },
  get coverage() {
    return contractCompat.coverage;
  },
  hostFamily,
  hostNamed,
  get local() {
    return contractBuild.local;
  },
  method,
  opaque,
  placedOn,
  placementText,
  get remote() {
    return contractBuild.remote;
  },
  resolveHost,
  get takesNoArgs() {
    return contractCompat.takesNoArgs;
  },
};

export default contract;
