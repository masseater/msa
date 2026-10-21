import { Console, Effect, Random, Scope } from "effect";

import type connectionTypes from "./connection.types.ts";
import type coreTypes from "./core.types.ts";
import type declsTypes from "./decls.types.ts";
import type hostTypesModule from "./host-types.types.ts";
import type objectTypes from "./object.types.ts";
import schemaModule from "./schema.ts";
import type serviceTypes from "./service.types.ts";
import HostTimers from "./timers.ts";
import type typesModule from "./types.types.ts";

const { canonicalJson } = schemaModule;

const randomTag = (): string => Effect.runSync(Random.next).toString(36).slice(2, 8);

const reportToConsole = (error: unknown): void => Effect.runSync(Console.error("chord:", error));

export default abstract class HostBase implements coreTypes.HostCore {
  readonly name: string;
  readonly dev: boolean;
  readonly principal: unknown;
  inFactory = 0;
  failed: unknown;
  readonly objects = new Map<string, objectTypes.ObjectImpl>();
  readonly codeVersions = new Map<number, hostTypesModule.CodeVersionState>();
  readonly facets = new Map<string, hostTypesModule.Facet>();
  readonly hostObjects = new Map<string, ReturnType<coreTypes.HostCore["acquire"]>>();
  readonly kind: "host" | "client";
  readonly connections = new Set<connectionTypes.Connection>();
  upstream: connectionTypes.Connection | undefined;
  remoteModules: Record<string, string[]> = {};
  remoteRemoved: Record<string, string[]> = {};
  readonly incarnation = randomTag();
  current: hostTypesModule.CodeVersionState;
  previous: hostTypesModule.CodeVersionState | undefined;
  pending: hostTypesModule.CodeVersionState | undefined;
  gating: ReadonlySet<string> | undefined;
  reloading = false;
  readonly taskStopDeadline: number;
  readonly readyTimeout: number;
  readonly scope = Scope.makeUnsafe();
  readonly timers = new HostTimers(this.scope);
  protected readonly options: hostTypesModule.HostOptions;
  readonly #principalKey: (principal: unknown) => string;
  readonly #selfKey: string;
  #codeVersionSeq = 1;

  constructor(options: hostTypesModule.HostOptions) {
    this.options = options;
    this.name = options.name ?? "host";
    this.dev = options.dev ?? false;
    if (!("self" in options))
      throw new TypeError("createHost needs `self`: the principal of the host's own code");
    this.principal = options.self;
    this.#principalKey = options.principalKey ?? canonicalJson;
    this.#selfKey = this.#principalKey(options.self);
    this.taskStopDeadline = options.taskStopDeadline ?? 5000;
    this.readyTimeout = options.readyTimeout ?? 60_000;
    this.current = {
      abort: new AbortController(),
      id: this.#codeVersionSeq,
      roots: new Map(),
      services: new Map(),
      tables: new Map(),
    };
    this.codeVersions.set(this.current.id, this.current);
    this.kind = options.kind ?? "host";
  }

  abstract acquire(
    ...args: Parameters<coreTypes.HostCore["acquire"]>
  ): ReturnType<coreTypes.HostCore["acquire"]>;
  abstract addressOf(...args: Parameters<coreTypes.HostCore["addressOf"]>): string;
  abstract touch(rootId: string, object: objectTypes.ObjectImpl): void;
  abstract forget(object: objectTypes.ObjectImpl): void;
  abstract disposed(object: objectTypes.ObjectImpl): void;
  abstract checkRegistrations(object: objectTypes.ObjectImpl, decls: declsTypes.Decls): void;
  abstract registriesChanged(including?: objectTypes.ObjectImpl): void;
  abstract root<T>(
    fn: (ctx: typesModule.Ctx) => T | Promise<T>,
    options?: { codeVersion?: number; signal?: AbortSignal | undefined },
  ): Promise<T>;

  isSelf(principal: unknown): boolean {
    return principal === this.principal || this.#principalKey(principal) === this.#selfKey;
  }

  principalPart(principal: unknown): string {
    return this.isSelf(principal) ? "host" : `p:${this.#principalKey(principal)}`;
  }

  get codeVersion(): number {
    return this.current.id;
  }

  get previousCodeVersion(): number | undefined {
    return this.previous?.id;
  }

  nextCodeVersionId(given?: number): number {
    if (given !== undefined && given <= this.current.id)
      throw new Error(`code version ${given} is not newer than ${this.current.id}`);
    this.#codeVersionSeq = given ?? this.#codeVersionSeq + 1;
    return this.#codeVersionSeq;
  }

  peekNextCodeVersion(): number {
    return this.#codeVersionSeq + 1;
  }

  report(error: unknown): void {
    if (this.options.onError === undefined) reportToConsole(error);
    else this.options.onError(error);
  }

  fail(error: unknown): void {
    this.failed ??= error;
    this.report(error);
  }

  currentCodeVersion(): number {
    return this.current.id;
  }

  hasCodeVersion(codeVersion: number): boolean {
    return this.codeVersions.has(codeVersion);
  }

  *retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, serviceTypes.Service>]> {
    for (const [id, state] of this.codeVersions) yield [id, state.services];
    if (this.pending !== undefined) yield [this.pending.id, this.pending.services];
  }

  pendingCodeVersion(): number | undefined {
    return this.pending?.id;
  }

  service(typeName: string): serviceTypes.Service | undefined {
    return this.current.services.get(typeName) ?? this.pending?.services.get(typeName);
  }
}
