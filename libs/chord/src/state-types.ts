import type contextTypes from "./context/index.types.ts";
import type deltaTypes from "./delta/index.types.ts";

declare namespace stateTypesModule {
  interface ReplicatedStateDelivery {
    readonly kind: "hydrate" | "update";
    readonly sequence: number;
  }

  interface ReplicatedState<T> {
    readonly value: T | undefined;
    subscribe(
      listener: (
        value: T,
        context: contextTypes.Context,
        delivery: ReplicatedStateDelivery,
      ) => Promise<void>,
    ): () => void;
    subscribe(
      listener: (
        value: T,
        context: contextTypes.Context,
        delivery: ReplicatedStateDelivery,
      ) => void,
    ): () => void;
  }

  interface MutableReplicatedState<T extends object> extends ReplicatedState<T> {
    readonly value: T;
    change(context: contextTypes.Context, mutate: (draft: deltaTypes.Draft<T>) => void): void;
    replace(context: contextTypes.Context, value: T): void;
  }

  interface ReplicatedStateSourceFrame<T> {
    readonly cursor: number;
    readonly value: T;
    readonly ops: readonly deltaTypes.Op[];
    readonly context: contextTypes.Context;
  }

  interface ReplicatedStateSourceAttachment<T> {
    readonly snapshot: { readonly value: T; readonly cursor: number };
    activate(listener: (frame: ReplicatedStateSourceFrame<T>) => void): void;
    dispose(): void;
  }

  interface ReplicatedStateSource<T> {
    attach(): ReplicatedStateSourceAttachment<T>;
  }

  interface ReplicatedStateSourceOptions {
    readonly onError?: (error: Error) => void;
  }

  interface AttachedReplicatedState<T> extends ReplicatedState<T> {
    readonly value: T;
    dispose(): void;
  }

  type StateListener<T> = (
    value: T,
    context: contextTypes.Context,
    delivery: ReplicatedStateDelivery,
  ) => void;

  type StateDelivery<T> = {
    readonly value: T;
    readonly context: contextTypes.Context;
    readonly delivery: ReplicatedStateDelivery;
  };
}

export type { stateTypesModule as default };
