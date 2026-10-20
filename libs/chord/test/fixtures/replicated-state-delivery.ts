import { Deferred, Effect } from "effect";
import { dual } from "effect/Function";

import {
  type Context,
  type ReplicatedState,
  type ReplicatedStateSourceFrame,
  replicatedState,
} from "../../src/index.ts";
import type replicatedStateDeliveryTypes from "./replicated-state-delivery.types.ts";

function deferred() {
  const gate = Deferred.makeUnsafe<void, Error>();
  return {
    promise: Effect.runPromise(Deferred.await(gate)),
    reject: (error: Error) => {
      Deferred.doneUnsafe(gate, Effect.fail(error));
    },
    resolve: () => {
      Deferred.doneUnsafe(gate, Effect.void);
    },
  };
}

function fixtureImpl(
  kind: replicatedStateDeliveryTypes.Kind,
  onError: (error: Error) => void = () => {},
): replicatedStateDeliveryTypes.DeliveryFixture {
  let state: ReplicatedState<replicatedStateDeliveryTypes.Value>;
  let publish: (value: replicatedStateDeliveryTypes.Value, context: Context) => void;
  if (kind === "mutable") {
    const mutable = replicatedState({ value: 0 });
    state = mutable;
    publish = (value, context) => mutable.replace(context, value);
  } else {
    let receive!: (frame: ReplicatedStateSourceFrame<replicatedStateDeliveryTypes.Value>) => void;
    state = replicatedState<replicatedStateDeliveryTypes.Value>(
      {
        attach: () => ({
          activate: (listener) => {
            receive = listener;
          },
          dispose() {},
          snapshot: { cursor: 0, value: { value: 0 } },
        }),
      },
      { onError },
    );
    publish = (value, context) =>
      receive({ context, cursor: value.value, ops: [["s", ["value"], value.value]], value });
  }
  return { publish, state };
}

const fixture: {
  (
    onError?: (error: Error) => void,
  ): (kind: replicatedStateDeliveryTypes.Kind) => replicatedStateDeliveryTypes.DeliveryFixture;
  (
    kind: replicatedStateDeliveryTypes.Kind,
    onError?: (error: Error) => void,
  ): replicatedStateDeliveryTypes.DeliveryFixture;
} = dual((args: IArguments) => typeof args[0] === "string", fixtureImpl);

const replicatedStateDelivery = {
  deferred,
  fixture,
};

export default replicatedStateDelivery;
