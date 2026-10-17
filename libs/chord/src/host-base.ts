import { Console, Effect, Random } from "effect";

import type { Connection } from "./connection.ts";
import type { HostCore } from "./core.ts";
import type { Decls } from "./decls.ts";
import type { CodeVersionState, Facet, HostOptions } from "./host-types.ts";
import type { ObjectImpl } from "./object.ts";
import { canonicalJson } from "./schema.ts";
import type { Service } from "./service.ts";
import type { Ctx } from "./types.ts";

const randomTag = (): string => Effect.runSync(Random.next).toString(36).slice(2, 8);

const reportToConsole = (error: unknown): void => Effect.runSync(Console.error("chord:", error));

export abstract class HostBase implements HostCore {
  readonly name: string;
  readonly dev: boolean;
  readonly principal: unknown;
  inFactory = 0;
  failed: unknown;
  readonly objects = new Map<string, ObjectImpl>();
  readonly codeVersions = new Map<number, CodeVersionState>();
  readonly facets = new Map<string, Facet>();
  readonly hostObjects = new Map<string, ReturnType<HostCore["acquire"]>>();
  readonly kind: "host" | "client";
  readonly connections = new Set<Connection>();
  upstream: Connection | undefined;
  remoteModules: Record<string, string[]> = {};
  remoteRemoved: Record<string, string[]> = {};
  readonly incarnation = randomTag();
  current: CodeVersionState;
  previous: CodeVersionState | undefined;
  pending: CodeVersionState | undefined;
  gating: ReadonlySet<string> | undefined;
  reloading = false;
  readonly taskStopDeadline: number;
  readonly readyTimeout: number;
  protected readonly options: HostOptions;
  readonly #principalKey: (principal: unknown) => string;
  readonly #selfKey: string;
  #codeVersionSeq = 1;

  constructor(options: HostOptions) {
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
      id: this.#codeVersionSeq,
      services: new Map(),
      tables: new Map(),
      roots: new Map(),
      abort: new AbortController(),
    };
    this.codeVersions.set(this.current.id, this.current);
    this.kind = options.kind ?? "host";
  }

  abstract acquire(...args: Parameters<HostCore["acquire"]>): ReturnType<HostCore["acquire"]>;
  abstract addressOf(...args: Parameters<HostCore["addressOf"]>): string;
  abstract touch(rootId: string, object: ObjectImpl): void;
  abstract forget(object: ObjectImpl): void;
  abstract disposed(object: ObjectImpl): void;
  abstract checkRegistrations(object: ObjectImpl, decls: Decls): void;
  abstract registriesChanged(including?: ObjectImpl): void;
  abstract root<T>(
    fn: (ctx: Ctx) => T | Promise<T>,
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

  *retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, Service>]> {
    for (const [id, state] of this.codeVersions) yield [id, state.services];
    if (this.pending !== undefined) yield [this.pending.id, this.pending.services];
  }

  pendingCodeVersion(): number | undefined {
    return this.pending?.id;
  }

  service(typeName: string): Service | undefined {
    return this.current.services.get(typeName) ?? this.pending?.services.get(typeName);
  }
}
