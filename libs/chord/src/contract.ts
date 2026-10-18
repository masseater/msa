import { dual } from "effect/Function";
import { type Static, type TSchema, Type } from "typebox";

import { invalid } from "./errors.ts";

export const MEMBER: unique symbol = Symbol("chord.member");

export interface MethodSpec<
  A extends TSchema | undefined = TSchema | undefined,
  R extends TSchema | undefined = TSchema | undefined,
> {
  readonly [MEMBER]: "method";
  readonly args: A;
  readonly result: R;
}

export interface OpaqueSpec<T = unknown> {
  readonly [MEMBER]: "opaque";
  readonly id: string;
  readonly type?: T;
}

export function method(...input: []): MethodSpec<undefined, undefined>;
export function method<A extends TSchema>(...input: [args: A]): MethodSpec<A, undefined>;
export function method<A extends TSchema | undefined, R extends TSchema>(
  ...input: [args: A, result: R]
): MethodSpec<A, R>;
export function method(...[args, result]: [args?: TSchema, result?: TSchema]): MethodSpec {
  return { [MEMBER]: "method", args, result };
}

export const opaque = <T = unknown>(id: string): OpaqueSpec<T> => {
  if (!/^[^@\s]+@\d+$/u.test(id)) throw new TypeError(`opaque id must be name@version: ${id}`);
  return { [MEMBER]: "opaque", id };
};

export interface VariantDef {
  readonly state?: Readonly<Record<string, TSchema>>;
  readonly methods?: Readonly<Record<string, MethodSpec>>;
}

export interface HostNamed {
  readonly name: string;
}

export interface HostFamily<K extends string = string> {
  readonly prefix: string;
  readonly key: K;
}

export type Placement = HostNamed | HostFamily;

export function hostNamed(name: string): HostNamed {
  if (typeof name !== "string" || name === "") throw new TypeError("hostNamed needs a host name");
  return { name };
}

function familyOfHosts<const K extends string>(prefix: string, key: K): HostFamily<K> {
  if (typeof prefix !== "string" || prefix === "")
    throw new TypeError("hostFamily needs a host-name prefix");
  if (typeof key !== "string" || key === "")
    throw new TypeError("hostFamily needs an input field name");
  return { prefix, key };
}

type StringKeys<I> = { [K in keyof I]-?: I[K] extends string ? K : never }[keyof I] & string;
export type PlacementFor<I> = HostNamed | HostFamily<StringKeys<I>>;

function hostOf(typeName: string, placement: Placement, input: unknown): string {
  if ("name" in placement) return placement.name;
  const value =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)[placement.key]
      : undefined;
  if (typeof value !== "string" || value === "")
    throw invalid("placement", `${typeName}: input field ${placement.key} names no host`);
  return placement.prefix + value;
}

export const placedOn: {
  (hostName: string): (placement: Placement) => boolean;
  (placement: Placement, hostName: string): boolean;
} = dual(2, (placement: Placement, hostName: string): boolean =>
  "name" in placement
    ? placement.name === hostName
    : hostName.startsWith(placement.prefix) && hostName.length > placement.prefix.length,
);

export const placementText = (placement: Placement): string =>
  "name" in placement ? placement.name : `${placement.prefix}<${placement.key}>`;

export interface RemoteDef {
  readonly version: number;
  readonly input: TSchema;
  readonly host: Placement;
  readonly variants: Readonly<Record<string, VariantDef>>;
}

export type LocalMember = MethodSpec | OpaqueSpec | TSchema;

export interface LocalDef {
  readonly version: number;
  readonly input: TSchema;
  readonly members?: Readonly<Record<string, LocalMember>>;
}

const SchemaObject = Type.Unsafe<TSchema>(Type.Object({}));

const MemberDescriptionSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("method"),
    args: Type.Optional(SchemaObject),
    result: Type.Optional(SchemaObject),
  }),
  Type.Object({ kind: Type.Literal("state"), schema: SchemaObject }),
  Type.Object({ kind: Type.Literal("opaque"), id: Type.String() }),
]);
export type MemberDescription = Static<typeof MemberDescriptionSchema>;

export const LOCAL_VARIANT = "";

export const PlacementSchema = Type.Union([
  Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object(
    { prefix: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export const DescriptionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  scope: Type.Union([Type.Literal("remote"), Type.Literal("local")]),
  version: Type.Integer(),
  input: SchemaObject,
  host: Type.Optional(PlacementSchema),
  variants: Type.Record(Type.String(), Type.Record(Type.String(), MemberDescriptionSchema)),
});
export type Description = Static<typeof DescriptionSchema>;

interface ContractBase {
  readonly name: string;
  readonly version: number;
  readonly input: TSchema;
  readonly description: Description;
  readonly fingerprint: string;
}

export interface RemoteContract<D extends RemoteDef = RemoteDef> extends ContractBase {
  readonly scope: "remote";
  readonly def: D;
}

export interface LocalContract<D extends LocalDef = LocalDef> extends ContractBase {
  readonly scope: "local";
  readonly def: D;
}

export type AnyContract = RemoteContract | LocalContract;

export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
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

export type Adapter = (current: Record<string, unknown>) => Record<string, unknown>;
export type Accepts = Readonly<Record<number, Adapter>>;

export { bind, coverage, takesNoArgs } from "./contract-compat.ts";
export type {
  Call,
  ImplementationOf,
  InputOf,
  MethodImplementation,
  Ref,
} from "./contract-shapes.ts";

export const hostFamily: {
  <const K extends string>(key: K): (prefix: string) => HostFamily<K>;
  <const K extends string>(prefix: string, key: K): HostFamily<K>;
} = dual(2, familyOfHosts);

export const resolveHost: {
  (placement: Placement, input: unknown): (typeName: string) => string;
  (typeName: string, placement: Placement, input: unknown): string;
} = dual(3, hostOf);

export { contractFromDescription, local, remote } from "./contract-build.ts";
