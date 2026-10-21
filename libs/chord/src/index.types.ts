import type contractShapesTypes from "./contract-shapes.ts";
import type contractTypes from "./contract.types.ts";
import type chordCoreKitTypes from "./index-kit/core.types.ts";
import type chordLinksKitTypes from "./index-kit/links.types.ts";
import type chordStateKitTypes from "./index-kit/state.types.ts";
import type serviceTypes from "./service.types.ts";

declare namespace chordTypes {
  type AcceptOptions<P = unknown> = chordLinksKitTypes.AcceptOptions<P>;

  type LinkOptions = chordLinksKitTypes.LinkOptions;

  type Context = chordCoreKitTypes.Context;

  type ContextKey<T> = chordCoreKitTypes.ContextKey<T>;

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

  type EventOf<S> = chordCoreKitTypes.EventOf<S>;

  type Resource<T> = chordCoreKitTypes.Resource<T>;

  type ResourceDeclaration<T> = chordCoreKitTypes.ResourceDeclaration<T>;

  type Subscribable<E> = chordCoreKitTypes.Subscribable<E>;

  type ValueOf<S> = chordCoreKitTypes.ValueOf<S>;

  type Draft<T, Depth extends readonly unknown[] = []> = chordStateKitTypes.Draft<T, Depth>;

  type ChordErrorCode = chordCoreKitTypes.ChordErrorCode;

  type ConnectOptions<P = unknown> = chordCoreKitTypes.ConnectOptions<P>;

  type PrincipalMatch<P = unknown> = chordCoreKitTypes.PrincipalMatch<P>;

  type PrincipalPattern<P> = chordCoreKitTypes.PrincipalPattern<P>;

  type Route<P = unknown> = chordCoreKitTypes.Route<P>;

  type Facet<P = unknown> = chordCoreKitTypes.Facet<P>;

  type FacetApi<P = unknown> = chordCoreKitTypes.FacetApi<P>;

  type FacetDefinition<P = unknown> = chordCoreKitTypes.FacetDefinition<P>;

  type FacetLoader = chordCoreKitTypes.FacetLoader;

  type Host<P = unknown> = chordCoreKitTypes.Host<P>;

  type HostOptions<P = unknown> = chordCoreKitTypes.HostOptions<P>;

  type LoadOptions = chordCoreKitTypes.LoadOptions;

  type PluginRef<P = unknown> = chordCoreKitTypes.PluginRef<P>;

  type RootOptions<P = unknown> = chordCoreKitTypes.RootOptions<P>;

  type CopyJsonOptions = chordCoreKitTypes.CopyJsonOptions;

  type JsonRepresentation<T> = chordCoreKitTypes.JsonRepresentation<T>;

  type JsonValue = chordCoreKitTypes.JsonValue;

  type IpcChannel = chordLinksKitTypes.IpcChannel;

  type Link = chordLinksKitTypes.Link;

  type WebSocketLike = chordLinksKitTypes.WebSocketLike;

  type WebSocketLinkOptions = chordLinksKitTypes.WebSocketLinkOptions;

  type Factory<C extends contractTypes.AnyContract, P = unknown> = serviceTypes.Factory<C, P>;

  type HostServeOptions = serviceTypes.HostServeOptions;

  type Lifetime = serviceTypes.Lifetime;

  type ReferencedServeOptions = serviceTypes.ReferencedServeOptions;

  type Self<P = unknown> = serviceTypes.Self<P>;

  type ServeOptions = serviceTypes.ServeOptions;

  type ServeOptionsFor<C extends contractTypes.AnyContract> = serviceTypes.ServeOptionsFor<C>;

  type StateInit<T, P = unknown> = serviceTypes.StateInit<T, P>;

  type StateOptions<T> = serviceTypes.StateOptions<T>;

  type Registry<V> = chordStateKitTypes.Registry<V>;

  type RegistryTable<V> = chordStateKitTypes.RegistryTable<V>;

  type RegistryView<V> = chordStateKitTypes.RegistryView<V>;

  type ReloadOptions = chordStateKitTypes.ReloadOptions;

  type ReloadReport = chordStateKitTypes.ReloadReport;

  type AttachedReplicatedState<T> = chordStateKitTypes.AttachedReplicatedState<T>;

  type MutableReplicatedState<T extends object> = chordStateKitTypes.MutableReplicatedState<T>;

  type ReplicatedState<T> = chordStateKitTypes.ReplicatedState<T>;

  type ReplicatedStateDelivery = chordStateKitTypes.ReplicatedStateDelivery;

  type ReplicatedStateSource<T> = chordStateKitTypes.ReplicatedStateSource<T>;

  type ReplicatedStateSourceAttachment<T> = chordStateKitTypes.ReplicatedStateSourceAttachment<T>;

  type ReplicatedStateSourceFrame<T> = chordStateKitTypes.ReplicatedStateSourceFrame<T>;

  type ReplicatedStateSourceOptions = chordStateKitTypes.ReplicatedStateSourceOptions;

  type Ctx<P = unknown> = chordCoreKitTypes.Ctx<P>;

  type GetOptions<P = unknown> = chordCoreKitTypes.GetOptions<P>;

  type Readable<T> = chordCoreKitTypes.Readable<T>;

  type RefStatus = chordCoreKitTypes.RefStatus;

  type Shape = chordCoreKitTypes.Shape;

  type StateEvent<T> = chordCoreKitTypes.StateEvent<T>;

  type WebSocketAcceptOptions<Request, P = unknown> = chordLinksKitTypes.WebSocketAcceptOptions<
    Request,
    P
  >;

  type WebSocketServerLike<Request> = chordLinksKitTypes.WebSocketServerLike<Request>;

  type Frame = chordLinksKitTypes.Frame;

  type Cell<T> = chordStateKitTypes.Cell<T>;

  type ChordError = chordCoreKitTypes.ChordError;
}

export type { chordTypes as default };
