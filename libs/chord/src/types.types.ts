import type contractTypes from "./contract.types.ts";
import type deltaTypes from "./delta/index.types.ts";

declare const EXPOSED: unique symbol;

declare namespace typesModule {
  interface GetOptions<P = unknown> {
    readonly principal?: P;
    readonly state?: boolean;
  }

  interface Ctx<P = unknown> {
    readonly signal: AbortSignal;
    readonly rootId: string;
    readonly codeVersion: number;
    readonly principal: P;
    get<C extends contractTypes.AnyContract>(
      type: C,
      input: contractTypes.InputOf<C>,
      options?: GetOptions<P>,
    ): Promise<contractTypes.Ref<C>>;
  }

  type StateEvent<T> =
    | { readonly type: "snap"; readonly value: T }
    | { readonly type: "ops"; readonly ops: readonly deltaTypes.Op[]; readonly value: T }
    | { readonly type: "reset"; readonly value: T };

  interface Readable<T> {
    readonly value: T;
    subscribe(listener: (value: T) => void): () => void;
    events(listener: (event: StateEvent<T>) => void): () => void;
  }

  type StateSource<T> = Readable<T>;

  interface Exposed<T> {
    readonly [EXPOSED]: T;
  }

  type RefStatus = "loading" | "live" | "released" | "gone";

  interface Shape {
    readonly variant: string | undefined;
    readonly members: readonly string[];
    readonly contract: string;
  }

  interface RefBase<C extends contractTypes.AnyContract> {
    readonly contract: C;
    readonly status: RefStatus;
    readonly ready: Promise<void>;
    readonly variant: string | undefined;
    readonly shape: Shape | undefined;
    readonly error: unknown;
    onShape(listener: (shape: Shape) => void): () => void;
    onStatus(listener: (status: RefStatus, error: unknown) => void): () => void;
    release(): void;
  }
}

export type { typesModule as default };
