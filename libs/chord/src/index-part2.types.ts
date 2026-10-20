import type cellTypes from "./cell.types.ts";
import type linkWebsocketTypes from "./link-websocket.types.ts";
import type registryTypes from "./registry.types.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import type stateTypesModule from "./state-types.ts";
import type chordTypesModule from "./types.types.ts";
import type websocketTypes from "./websocket.types.ts";
import type wireTypes from "./wire.types.ts";

declare namespace chordTypesPart2 {
  type WebSocketLike = linkWebsocketTypes.WebSocketLike;

  type WebSocketLinkOptions = linkWebsocketTypes.WebSocketLinkOptions;

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

  type Ctx<P = unknown> = chordTypesModule.Ctx<P>;

  type GetOptions<P = unknown> = chordTypesModule.GetOptions<P>;

  type Readable<T> = chordTypesModule.Readable<T>;

  type RefStatus = chordTypesModule.RefStatus;

  type Shape = chordTypesModule.Shape;

  type StateEvent<T> = chordTypesModule.StateEvent<T>;

  type WebSocketAcceptOptions<Request, P = unknown> = websocketTypes.WebSocketAcceptOptions<
    Request,
    P
  >;

  type WebSocketServerLike<Request> = websocketTypes.WebSocketServerLike<Request>;

  type Frame = wireTypes.Frame;

  type Cell<T> = cellTypes.Cell<T>;
}

export type { chordTypesPart2 as default };
