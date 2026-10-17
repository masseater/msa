import { dual } from "effect/Function";

import type { AnyContract } from "./contract.ts";
import type { ListenerDecl } from "./declare.ts";
import type { Decls } from "./decls.ts";
import type { ObjectImpl } from "./object.ts";
import { enqueue } from "./publish.ts";
import type { Service } from "./service.ts";
import type { Ctx, GetOptions, RefStatus } from "./types.ts";

export type RefOwner = "object" | "call" | "host" | "external" | "connection" | "client";

export interface RefCore {
  readonly address: string;
  readonly contract: AnyContract;
  readonly status: RefStatus;
  readonly ready: Promise<void>;
  readonly proxy: object;
  readonly object: ObjectImpl | undefined;
  release(): void;
}

export interface HostCore {
  readonly name: string;
  readonly dev: boolean;
  readonly principal: unknown;
  inFactory: number;
  readonly failed: unknown;
  report(error: unknown): void;
  currentCodeVersion(): number;
  hasCodeVersion(codeVersion: number): boolean;
  retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, Service>]>;
  pendingCodeVersion(): number | undefined;
  service(typeName: string): Service | undefined;
  acquire(
    type: AnyContract,
    input: unknown,
    options: GetOptions | undefined,
    owner: RefOwner,
    from?: ObjectImpl,
    candidate?: boolean,
  ): RefCore;
  addressOf(type: AnyContract, input: unknown, principal: unknown, candidate?: boolean): string;
  root<T>(
    fn: (ctx: Ctx) => T | Promise<T>,
    options?: { codeVersion?: number; signal?: AbortSignal | undefined },
  ): Promise<T>;
  touch(rootId: string, object: ObjectImpl): void;
  forget(object: ObjectImpl): void;
  disposed(object: ObjectImpl): void;
  readonly taskStopDeadline: number;
  readonly readyTimeout: number;
  checkRegistrations(object: ObjectImpl, decls: Decls): void;
  registriesChanged(including?: ObjectImpl): void;
}

export const REF_BASE: ReadonlySet<PropertyKey> = new Set([
  "contract",
  "status",
  "ready",
  "variant",
  "shape",
  "error",
  "onShape",
  "onStatus",
  "release",
]);

export type StatusListener = (status: RefStatus, error: unknown) => void;

export const notifyStatus: {
  (
    status: RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): (listeners: ReadonlySet<StatusListener>) => void;
  (
    listeners: ReadonlySet<StatusListener>,
    status: RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): void;
} = dual(
  4,
  (
    listeners: ReadonlySet<StatusListener>,
    status: RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): void => {
    if (listeners.size === 0) return;
    const current = [...listeners];
    enqueue(() => {
      for (const listener of current) {
        try {
          listener(status, error);
        } catch (thrown) {
          report(thrown);
        }
      }
    });
  },
);

export const refsByProxy = new WeakMap<object, RefCore>();
export const refOf = (value: unknown): RefCore | undefined =>
  value !== null && typeof value === "object" ? refsByProxy.get(value) : undefined;

export type ObjectStatus = "activating" | "live" | "failed" | "disposing" | "disposed";

export interface Gate {
  readonly grandfathered: Set<string>;
  readonly queue: { readonly key: string; readonly event: unknown }[];
  drained: () => void;
}

export interface Subscription {
  readonly origin: unknown;
  readonly select: ListenerDecl["select"];
  unsubscribe: () => void;
}

export interface StagedListeners {
  activate(): void;
  discard(): void;
}

export interface ObjectIdentity {
  readonly address: string;
  readonly typeName: string;
  readonly input: unknown;
  readonly principal: unknown;
  readonly hostLifetime: boolean;
}

export interface Installed {
  readonly codeVersion: number;
  readonly service: Service;
  readonly implementation: Record<string, unknown>;
  readonly decls: Decls;
}
