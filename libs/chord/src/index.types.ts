import type contractShapesTypes from "./contract-shapes.ts";
import type contractTypes from "./contract.types.ts";
import type chordTypesPart1 from "./index-part1.types.ts";
import type chordTypesPart2 from "./index-part2.types.ts";
import type serviceTypes from "./service.types.ts";

declare namespace chordTypes {
  type AcceptOptions<P = unknown> = chordTypesPart1.AcceptOptions<P>;

  type LinkOptions = chordTypesPart1.LinkOptions;

  type Context = chordTypesPart1.Context;

  type ContextKey<T> = chordTypesPart1.ContextKey<T>;

  type Accepts = contractTypes.Accepts;

  type Adapter = contractTypes.Adapter;

  type AnyContract = contractTypes.AnyContract;

  type Description = contractTypes.Description;

  type HostFamily<K extends string = string> = contractTypes.HostFamily<K>;

  type HostNamed = contractTypes.HostNamed;

  type ImplementationOf<C, P = unknown> = contractShapesTypes.ImplementationOf<C, P>;

  type InputOf<C> = contractShapesTypes.InputOf<C>;

  type LocalContract<D extends contractTypes.LocalDef = contractTypes.LocalDef> =
    contractTypes.LocalContract<D>;

  type Placement = contractTypes.Placement;

  type PlacementFor<I> = contractTypes.PlacementFor<I>;

  type Ref<C extends contractTypes.AnyContract = contractTypes.AnyContract> =
    contractShapesTypes.Ref<C>;

  type RemoteContract<D extends contractTypes.RemoteDef = contractTypes.RemoteDef> =
    contractTypes.RemoteContract<D>;

  type EventOf<S> = chordTypesPart1.EventOf<S>;

  type Resource<T> = chordTypesPart1.Resource<T>;

  type ResourceDeclaration<T> = chordTypesPart1.ResourceDeclaration<T>;

  type Subscribable<E> = chordTypesPart1.Subscribable<E>;

  type ValueOf<S> = chordTypesPart1.ValueOf<S>;

  type Draft<T, Depth extends readonly unknown[] = []> = chordTypesPart1.Draft<T, Depth>;

  type ChordErrorCode = chordTypesPart1.ChordErrorCode;

  type ConnectOptions<P = unknown> = chordTypesPart1.ConnectOptions<P>;

  type PrincipalMatch<P = unknown> = chordTypesPart1.PrincipalMatch<P>;

  type PrincipalPattern<P> = chordTypesPart1.PrincipalPattern<P>;

  type Route<P = unknown> = chordTypesPart1.Route<P>;

  type Facet<P = unknown> = chordTypesPart1.Facet<P>;

  type FacetApi<P = unknown> = chordTypesPart1.FacetApi<P>;

  type FacetDefinition<P = unknown> = chordTypesPart1.FacetDefinition<P>;

  type FacetLoader = chordTypesPart1.FacetLoader;

  type Host<P = unknown> = chordTypesPart1.Host<P>;

  type HostOptions<P = unknown> = chordTypesPart1.HostOptions<P>;

  type LoadOptions = chordTypesPart1.LoadOptions;

  type PluginRef<P = unknown> = chordTypesPart1.PluginRef<P>;

  type RootOptions<P = unknown> = chordTypesPart1.RootOptions<P>;

  type CopyJsonOptions = chordTypesPart1.CopyJsonOptions;

  type JsonRepresentation<T> = chordTypesPart1.JsonRepresentation<T>;

  type JsonValue = chordTypesPart1.JsonValue;

  type IpcChannel = chordTypesPart1.IpcChannel;

  type Link = chordTypesPart1.Link;

  type WebSocketLike = chordTypesPart2.WebSocketLike;

  type WebSocketLinkOptions = chordTypesPart2.WebSocketLinkOptions;

  type Factory<C extends contractTypes.AnyContract, P = unknown> = serviceTypes.Factory<C, P>;

  type HostServeOptions = serviceTypes.HostServeOptions;

  type Lifetime = serviceTypes.Lifetime;

  type ReferencedServeOptions = serviceTypes.ReferencedServeOptions;

  type Self<P = unknown> = serviceTypes.Self<P>;

  type ServeOptions = serviceTypes.ServeOptions;

  type ServeOptionsFor<C extends contractTypes.AnyContract> = serviceTypes.ServeOptionsFor<C>;

  type StateInit<T, P = unknown> = serviceTypes.StateInit<T, P>;

  type StateOptions<T> = serviceTypes.StateOptions<T>;

  type Registry<V> = chordTypesPart2.Registry<V>;

  type RegistryTable<V> = chordTypesPart2.RegistryTable<V>;

  type RegistryView<V> = chordTypesPart2.RegistryView<V>;

  type ReloadOptions = chordTypesPart2.ReloadOptions;

  type ReloadReport = chordTypesPart2.ReloadReport;

  type AttachedReplicatedState<T> = chordTypesPart2.AttachedReplicatedState<T>;

  type MutableReplicatedState<T extends object> = chordTypesPart2.MutableReplicatedState<T>;

  type ReplicatedState<T> = chordTypesPart2.ReplicatedState<T>;

  type ReplicatedStateDelivery = chordTypesPart2.ReplicatedStateDelivery;

  type ReplicatedStateSource<T> = chordTypesPart2.ReplicatedStateSource<T>;

  type ReplicatedStateSourceAttachment<T> = chordTypesPart2.ReplicatedStateSourceAttachment<T>;

  type ReplicatedStateSourceFrame<T> = chordTypesPart2.ReplicatedStateSourceFrame<T>;

  type ReplicatedStateSourceOptions = chordTypesPart2.ReplicatedStateSourceOptions;

  type Ctx<P = unknown> = chordTypesPart2.Ctx<P>;

  type GetOptions<P = unknown> = chordTypesPart2.GetOptions<P>;

  type Readable<T> = chordTypesPart2.Readable<T>;

  type RefStatus = chordTypesPart2.RefStatus;

  type Shape = chordTypesPart2.Shape;

  type StateEvent<T> = chordTypesPart2.StateEvent<T>;

  type WebSocketAcceptOptions<Request, P = unknown> = chordTypesPart2.WebSocketAcceptOptions<
    Request,
    P
  >;

  type WebSocketServerLike<Request> = chordTypesPart2.WebSocketServerLike<Request>;

  type Frame = chordTypesPart2.Frame;

  type Cell<T> = chordTypesPart2.Cell<T>;

  type ChordError = chordTypesPart1.ChordError;
}

export type { chordTypes as default };
