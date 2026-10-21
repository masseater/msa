import type { Static, TSchema } from "typebox";

import type contractShapesTypes from "./contract-shapes.ts";
import type contract from "./contract.ts";

declare namespace contractTypes {
  interface MethodSpec<
    A extends TSchema | undefined = TSchema | undefined,
    R extends TSchema | undefined = TSchema | undefined,
  > {
    readonly [contract.MEMBER]: "method";
    readonly args: A;
    readonly result: R;
  }

  interface OpaqueSpec<T = unknown> {
    readonly [contract.MEMBER]: "opaque";
    readonly id: string;
    readonly type?: T;
  }

  interface VariantDef {
    readonly state?: Readonly<Record<string, TSchema>>;
    readonly methods?: Readonly<Record<string, MethodSpec>>;
  }

  interface HostNamed {
    readonly name: string;
  }

  interface HostFamily<K extends string = string> {
    readonly prefix: string;
    readonly key: K;
  }

  type Placement = HostNamed | HostFamily;

  type StringKeys<I> = { [K in keyof I]-?: I[K] extends string ? K : never }[keyof I] & string;

  type PlacementFor<I> = HostNamed | HostFamily<StringKeys<I>>;

  interface RemoteDef {
    readonly version: number;
    readonly input: TSchema;
    readonly host: Placement;
    readonly variants: Readonly<Record<string, VariantDef>>;
  }

  type LocalMember = MethodSpec | OpaqueSpec | TSchema;

  interface LocalDef {
    readonly version: number;
    readonly input: TSchema;
    readonly members?: Readonly<Record<string, LocalMember>>;
  }

  type MemberDescription = Static<typeof contract.MemberDescriptionSchema>;

  type Description = Static<typeof contract.DescriptionSchema>;

  interface ContractBase {
    readonly name: string;
    readonly version: number;
    readonly input: TSchema;
    readonly description: Description;
    readonly fingerprint: string;
  }

  interface RemoteContract<D extends RemoteDef = RemoteDef> extends ContractBase {
    readonly scope: "remote";
    readonly def: D;
  }

  interface LocalContract<D extends LocalDef = LocalDef> extends ContractBase {
    readonly scope: "local";
    readonly def: D;
  }

  type AnyContract = RemoteContract | LocalContract;

  type Adapter = (current: Record<string, unknown>) => Record<string, unknown>;

  type Accepts = Readonly<Record<number, Adapter>>;

  type Call<M> = contractShapesTypes.Call<M>;

  type ImplementationOf<C, P = unknown> = contractShapesTypes.ImplementationOf<C, P>;

  type InputOf<C> = contractShapesTypes.InputOf<C>;

  type MethodImplementation<M, P = unknown> = contractShapesTypes.MethodImplementation<M, P>;

  type Ref<C extends contractTypes.AnyContract = contractTypes.AnyContract> =
    contractShapesTypes.Ref<C>;
}

export type { contractTypes as default };
