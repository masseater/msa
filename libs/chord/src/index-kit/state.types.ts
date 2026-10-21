import type cellTypes from "../cell.types.ts";
import type draftTypes from "../delta/draft.ts";
import type registryTypes from "../registry.types.ts";
import type reloadCandidateTypes from "../reload-candidate.types.ts";
import type stateTypesModule from "../state-types.ts";

declare namespace chordStateKitTypes {
  type Draft<T, Depth extends readonly unknown[] = []> = draftTypes.Draft<T, Depth>;

  type Registry<V> = registryTypes.Registry<V>;

  type RegistryTable<V> = registryTypes.RegistryTable<V>;

  type RegistryView<V> = registryTypes.RegistryView<V>;

  type ReloadOptions = reloadCandidateTypes.ReloadOptions;

  type ReloadReport = reloadCandidateTypes.ReloadReport;

  type AttachedReplicatedState<T> = stateTypesModule.AttachedReplicatedState<T>;

  type MutableReplicatedState<T extends object> = stateTypesModule.MutableReplicatedState<T>;

  type ReplicatedState<T> = stateTypesModule.ReplicatedState<T>;

  type ReplicatedStateDelivery = stateTypesModule.ReplicatedStateDelivery;

  type ReplicatedStateSource<T> = stateTypesModule.ReplicatedStateSource<T>;

  type ReplicatedStateSourceAttachment<T> = stateTypesModule.ReplicatedStateSourceAttachment<T>;

  type ReplicatedStateSourceFrame<T> = stateTypesModule.ReplicatedStateSourceFrame<T>;

  type ReplicatedStateSourceOptions = stateTypesModule.ReplicatedStateSourceOptions;

  type Cell<T> = cellTypes.Cell<T>;
}

export type { chordStateKitTypes as default };
