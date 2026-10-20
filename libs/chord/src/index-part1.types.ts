import type connectionTypesModule from "./connection-types.types.ts";
import type typesModule from "./context/types.types.ts";
import type declareTypes from "./declare.ts";
import type draftTypes from "./delta/draft.ts";
import type errorsTypes from "./errors.types.ts";
import type hostTypesModule from "./host-types.types.ts";
import type jsonTypes from "./json.types.ts";
import type linkBaseTypes from "./link-base.types.ts";
import type linkIpcTypes from "./link-ipc.types.ts";

declare namespace chordTypesPart1 {
  type AcceptOptions<P = unknown> = connectionTypesModule.AcceptOptions<P>;

  type LinkOptions = connectionTypesModule.LinkOptions;

  type Context = typesModule.Context;

  type ContextKey<T> = typesModule.ContextKey<T>;

  type EventOf<S> = declareTypes.EventOf<S>;

  type Resource<T> = declareTypes.Resource<T>;

  type ResourceDeclaration<T> = declareTypes.ResourceDeclaration<T>;

  type Subscribable<E> = declareTypes.Subscribable<E>;

  type ValueOf<S> = declareTypes.ValueOf<S>;

  type Draft<T, Depth extends readonly unknown[] = []> = draftTypes.Draft<T, Depth>;

  type ChordErrorCode = errorsTypes.ChordErrorCode;

  type ConnectOptions<P = unknown> = hostTypesModule.ConnectOptions<P>;

  type PrincipalMatch<P = unknown> = hostTypesModule.PrincipalMatch<P>;

  type PrincipalPattern<P> = hostTypesModule.PrincipalPattern<P>;

  type Route<P = unknown> = hostTypesModule.Route<P>;

  type Facet<P = unknown> = hostTypesModule.Facet<P>;

  type FacetApi<P = unknown> = hostTypesModule.FacetApi<P>;

  type FacetDefinition<P = unknown> = hostTypesModule.FacetDefinition<P>;

  type FacetLoader = hostTypesModule.FacetLoader;

  type Host<P = unknown> = hostTypesModule.Host<P>;

  type HostOptions<P = unknown> = hostTypesModule.HostOptions<P>;

  type LoadOptions = hostTypesModule.LoadOptions;

  type PluginRef<P = unknown> = hostTypesModule.PluginRef<P>;

  type RootOptions<P = unknown> = hostTypesModule.RootOptions<P>;

  type CopyJsonOptions = jsonTypes.CopyJsonOptions;

  type JsonRepresentation<T> = jsonTypes.JsonRepresentation<T>;

  type JsonValue = jsonTypes.JsonValue;

  type IpcChannel = linkIpcTypes.IpcChannel;

  type Link = linkBaseTypes.Link;

  type ChordError = errorsTypes.ChordError;
}

export type { chordTypesPart1 as default };
