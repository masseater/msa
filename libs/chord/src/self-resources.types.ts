import type coreTypes from "./core.types.ts";
import type declareTypes from "./declare.ts";
import type declsTypes from "./decls.types.ts";

declare namespace selfResourcesTypes {
  interface ResourceScope {
    readonly decls: declsTypes.Decls;
    readonly created: declsTypes.Run["created"];
    readonly previous: declsTypes.Decls | undefined;
    readonly host: coreTypes.HostCore;
  }

  type ListenerDecl = declareTypes.ListenerDecl;

  type Resource<T> = declareTypes.Resource<T>;

  type ResourceDeclaration<T> = declareTypes.ResourceDeclaration<T>;
}

export type { selfResourcesTypes as default };
