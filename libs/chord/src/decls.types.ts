import type cellTypes from "./cell.types.ts";
import type coreTypes from "./core.types.ts";
import type declsModule from "./decls.ts";
import type resourceTypes from "./resource.types.ts";
import type typesModule from "./types.types.ts";

declare namespace declsTypes {
  type TaskFn = (ctx: typesModule.Ctx) => Promise<void>;

  type InitFn = (ctx: typesModule.Ctx) => unknown;

  interface Run {
    readonly implementation: Record<string, unknown>;
    readonly decls: Decls;
    readonly created: {
      readonly refs: coreTypes.RefCore[];
      readonly resources: resourceTypes.ResourceImpl[];
      readonly derives: cellTypes.Derived<unknown>[];
      readonly inits: (readonly [cellTypes.Cell<unknown>, InitFn])[];
    };
  }

  type Decls = (typeof declsModule.Decls)["prototype"];
}

export type { declsTypes as default };
