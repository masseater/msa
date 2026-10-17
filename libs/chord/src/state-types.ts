import type { Context } from "./context/index.ts";
import type { Draft, Op } from "./delta/index.ts";

export interface ReplicatedStateDelivery {
  readonly kind: "hydrate" | "update";
  readonly sequence: number;
}

export interface ReplicatedState<T> {
  readonly value: T | undefined;
  subscribe(
    listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => Promise<void>,
  ): () => void;
  subscribe(
    listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => void,
  ): () => void;
}

export interface MutableReplicatedState<T extends object> extends ReplicatedState<T> {
  readonly value: T;
  change(context: Context, mutate: (draft: Draft<T>) => void): void;
  replace(context: Context, value: T): void;
}

export interface ReplicatedStateSourceFrame<T> {
  readonly cursor: number;
  readonly value: T;
  readonly ops: readonly Op[];
  readonly context: Context;
}

export interface ReplicatedStateSourceAttachment<T> {
  readonly snapshot: { readonly value: T; readonly cursor: number };
  activate(listener: (frame: ReplicatedStateSourceFrame<T>) => void): void;
  dispose(): void;
}

export interface ReplicatedStateSource<T> {
  attach(): ReplicatedStateSourceAttachment<T>;
}

export interface ReplicatedStateSourceOptions {
  readonly onError?: (error: Error) => void;
}

export interface AttachedReplicatedState<T> extends ReplicatedState<T> {
  readonly value: T;
  dispose(): void;
}

export type StateListener<T> = (
  value: T,
  context: Context,
  delivery: ReplicatedStateDelivery,
) => void;

export type StateDelivery<T> = {
  readonly value: T;
  readonly context: Context;
  readonly delivery: ReplicatedStateDelivery;
};
