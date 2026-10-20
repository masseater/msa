import { dual } from "effect/Function";

import AttachedReplicatedStateImpl from "./attached-replicated-state-impl.ts";
import type stateTypesModule from "./state-types.ts";

function attachSource<T>(
  source: stateTypesModule.ReplicatedStateSource<T>,
  options: stateTypesModule.ReplicatedStateSourceOptions,
): stateTypesModule.AttachedReplicatedState<T> {
  const attachment = source.attach();
  try {
    const state = new AttachedReplicatedStateImpl(attachment, options);
    state.activate();
    return state;
  } catch (error) {
    try {
      attachment.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], "Failed to attach replicated state source", {
        cause: disposeError,
      });
    }
    throw error;
  }
}

const attachReplicatedStateSource: {
  (
    options: stateTypesModule.ReplicatedStateSourceOptions,
  ): <T>(
    source: stateTypesModule.ReplicatedStateSource<T>,
  ) => stateTypesModule.AttachedReplicatedState<T>;
  <T>(
    source: stateTypesModule.ReplicatedStateSource<T>,
    options: stateTypesModule.ReplicatedStateSourceOptions,
  ): stateTypesModule.AttachedReplicatedState<T>;
} = dual(2, attachSource);

const stateAttached = {
  AttachedReplicatedStateImpl,
  attachReplicatedStateSource,
};

export default stateAttached;
