import { Deferred, Effect } from "effect";
import { dual } from "effect/Function";

import {
  type Context,
  type ReplicatedState,
  type ReplicatedStateSourceFrame,
  replicatedState,
} from "../../src/index.ts";

export interface DeliveryFixture {
  readonly state: ReplicatedState<Value>;
  readonly publish: (value: Value, context: Context) => void;
}

export type Value = { value: number };
export type Kind = "mutable" | "attached";

export function deferred() {
  const gate = Deferred.makeUnsafe<void, Error>();
  return {
    promise: Effect.runPromise(Deferred.await(gate)),
    resolve: () => {
      Deferred.doneUnsafe(gate, Effect.void);
    },
    reject: (error: Error) => {
      Deferred.doneUnsafe(gate, Effect.fail(error));
    },
  };
}

function fixtureImpl(kind: Kind, onError: (error: Error) => void = () => {}): DeliveryFixture {
  let state: ReplicatedState<Value>;
  let publish: (value: Value, context: Context) => void;
  if (kind === "mutable") {
    const mutable = replicatedState({ value: 0 });
    state = mutable;
    publish = (value, context) => mutable.replace(context, value);
  } else {
    let receive!: (frame: ReplicatedStateSourceFrame<Value>) => void;
    state = replicatedState<Value>(
      {
        attach: () => ({
          snapshot: { value: { value: 0 }, cursor: 0 },
          activate: (listener) => {
            receive = listener;
          },
          dispose() {},
        }),
      },
      { onError },
    );
    publish = (value, context) =>
      receive({ value, cursor: value.value, ops: [["s", ["value"], value.value]], context });
  }
  return { state, publish };
}

export const fixture: {
  (onError?: (error: Error) => void): (kind: Kind) => DeliveryFixture;
  (kind: Kind, onError?: (error: Error) => void): DeliveryFixture;
} = dual((args: IArguments) => typeof args[0] === "string", fixtureImpl);
