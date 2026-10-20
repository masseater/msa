import type { TSchema } from "typebox";

import type cellTypes from "./cell.types.ts";
import type coreTypes from "./core.types.ts";
import type declareTypes from "./declare.ts";
import type declsTypes from "./decls.types.ts";
import type registryTypes from "./registry.types.ts";
import type resourceTypes from "./resource.types.ts";

export default class Decls {
  readonly cells = new Map<string, cellTypes.Cell<unknown>>();
  readonly cellSchemas = new Map<string, TSchema>();
  readonly cellVersions = new Map<string, number>();
  readonly cellMigrations = new Map<string, (old: unknown, from: number) => unknown>();
  readonly refs = new Map<string, coreTypes.RefCore>();
  readonly resources = new Map<string, resourceTypes.ResourceImpl>();
  readonly adopted = new Map<
    resourceTypes.ResourceImpl,
    declareTypes.ResourceDeclaration<unknown>
  >();
  readonly listeners = new Map<string, declareTypes.ListenerDecl>();
  readonly tasks = new Map<string, declsTypes.TaskFn>();
  readonly derives = new Map<string, cellTypes.Derived<unknown>>();
  readonly registrations = new Map<string, registryTypes.Registration>();
}
