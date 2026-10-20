import { Deferred, Effect } from "effect";
import { dual } from "effect/Function";

import chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";
import type replicatedStateDeliveryTypes from "./replicated-state-delivery.types.ts";

const { replicatedState } = chord;

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
  let state: chordTypes.ReplicatedState<replicatedStateDeliveryTypes.Value>;
  let publish: (value: replicatedStateDeliveryTypes.Value, context: chordTypes.Context) => void;
  if (kind === "mutable") {
    const mutable = replicatedState({ value: 0 });
    state = mutable;
    publish = (value, context) => mutable.replace(context, value);
  } else {
    let receive!: (
      frame: chordTypes.ReplicatedStateSourceFrame<replicatedStateDeliveryTypes.Value>,
    ) => void;
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
