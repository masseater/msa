import type contractTypes from "./contract.types.ts";
import type declareTypes from "./declare.ts";
import type declsTypes from "./decls.types.ts";
import type objectTypes from "./object.types.ts";
import type serviceTypes from "./service.types.ts";
import type timersTypes from "./timers.types.ts";
import type typesModule from "./types.types.ts";

declare namespace coreTypes {
  type RefOwner = "object" | "call" | "host" | "external" | "connection" | "client";

  interface RefCore {
    readonly address: string;
    readonly contract: contractTypes.AnyContract;
    readonly status: typesModule.RefStatus;
    readonly ready: Promise<void>;
    readonly proxy: object;
    readonly object: objectTypes.ObjectImpl | undefined;
    release(): void;
  }

  interface HostCore {
    readonly name: string;
    readonly dev: boolean;
    readonly principal: unknown;
    inFactory: number;
    readonly failed: unknown;
    report(error: unknown): void;
    currentCodeVersion(): number;
    hasCodeVersion(codeVersion: number): boolean;
    retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, serviceTypes.Service>]>;
    pendingCodeVersion(): number | undefined;
    service(typeName: string): serviceTypes.Service | undefined;
    acquire(
      type: contractTypes.AnyContract,
      input: unknown,
      options: typesModule.GetOptions | undefined,
      owner: RefOwner,
      from?: objectTypes.ObjectImpl,
      candidate?: boolean,
    ): RefCore;
    addressOf(
      type: contractTypes.AnyContract,
      input: unknown,
      principal: unknown,
      candidate?: boolean,
    ): string;
    root<T>(
      fn: (ctx: typesModule.Ctx) => T | Promise<T>,
      options?: { codeVersion?: number; signal?: AbortSignal | undefined },
    ): Promise<T>;
    touch(rootId: string, object: objectTypes.ObjectImpl): void;
    forget(object: objectTypes.ObjectImpl): void;
    disposed(object: objectTypes.ObjectImpl): void;
    readonly taskStopDeadline: number;
    readonly readyTimeout: number;
    readonly timers: timersTypes.HostTimers;
    checkRegistrations(object: objectTypes.ObjectImpl, decls: declsTypes.Decls): void;
    registriesChanged(including?: objectTypes.ObjectImpl): void;
  }

  type StatusListener = (status: typesModule.RefStatus, error: unknown) => void;

  type ObjectStatus = "activating" | "live" | "failed" | "disposing" | "disposed";

  interface Gate {
    readonly grandfathered: Set<string>;
    readonly queue: { readonly key: string; readonly event: unknown }[];
    drained: () => void;
  }

  interface Subscription {
    readonly origin: unknown;
    readonly select: declareTypes.ListenerDecl["select"];
    unsubscribe: () => void;
  }

  interface StagedListeners {
    activate(): void;
    discard(): void;
  }

  interface ObjectIdentity {
    readonly address: string;
    readonly typeName: string;
    readonly input: unknown;
    readonly principal: unknown;
    readonly hostLifetime: boolean;
  }

  interface Installed {
    readonly codeVersion: number;
    readonly service: serviceTypes.Service;
    readonly implementation: Record<string, unknown>;
    readonly decls: declsTypes.Decls;
  }
}

export type { coreTypes as default };
