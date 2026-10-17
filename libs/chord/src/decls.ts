import type { TSchema } from "typebox";

import type { Cell, Derived } from "./cell.ts";
import type { RefCore } from "./core.ts";
import type { ListenerDecl, ResourceDeclaration } from "./declare.ts";
import type { Registration } from "./registry.ts";
import type { ResourceImpl } from "./resource.ts";
import type { StateInit } from "./service.ts";
import type { Ctx } from "./types.ts";

export type TaskFn = (ctx: Ctx) => Promise<void>;

export class Decls {
  readonly cells = new Map<string, Cell<unknown>>();
  readonly cellSchemas = new Map<string, TSchema>();
  readonly cellVersions = new Map<string, number>();
  readonly cellMigrations = new Map<string, (old: unknown, from: number) => unknown>();
  readonly refs = new Map<string, RefCore>();
  readonly resources = new Map<string, ResourceImpl>();
  readonly adopted = new Map<ResourceImpl, ResourceDeclaration<unknown>>();
  readonly listeners = new Map<string, ListenerDecl>();
  readonly tasks = new Map<string, TaskFn>();
  readonly derives = new Map<string, Derived<unknown>>();
  readonly registrations = new Map<string, Registration>();
}

export type InitFn = (ctx: Ctx) => unknown;

export interface Run {
  readonly implementation: Record<string, unknown>;
  readonly decls: Decls;
  readonly created: {
    readonly refs: RefCore[];
    readonly resources: ResourceImpl[];
    readonly derives: Derived<unknown>[];
    readonly inits: (readonly [Cell<unknown>, InitFn])[];
  };
}

export const isStateInit = (value: unknown): value is StateInit<unknown> =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { init?: unknown }).init === "function";
