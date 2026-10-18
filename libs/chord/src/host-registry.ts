import type { Decls } from "./decls.ts";
import { ChordError, invalid } from "./errors.ts";
import { HostRoots } from "./host-roots.ts";
import type { CodeVersionState } from "./host-types.ts";
import type { ObjectImpl } from "./object.ts";
import { enqueue } from "./publish.ts";
import type { Registry, RegistryTable, RegistryView } from "./registry.ts";
import type { Ctx } from "./types.ts";

type TableListener = (table: RegistryTable<unknown>, codeVersion: number) => void;

const EMPTY_TABLE: RegistryTable<never> = new Map<string, never>();

const sameTable = (a: RegistryTable<unknown>, b: RegistryTable<unknown>): boolean => {
  if (a.size !== b.size) return false;
  const keys = [...a.keys()];
  return [...b].every(([key, value], index) => keys[index] === key && a.get(key) === value);
};

const entryOf = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
};

export abstract class HostRegistries extends HostRoots {
  readonly #order = new Map<string, Map<string, number>>();
  readonly #subscribers = new Map<string, Set<TableListener>>();

  registry<V>(registry: Registry<V>): RegistryView<V> {
    const table = (ctx?: Ctx): RegistryTable<V> => {
      const codeVersion = ctx === undefined ? this.current : this.codeVersions.get(ctx.codeVersion);
      if (codeVersion === undefined)
        throw new ChordError("superseded", `code version ${ctx?.codeVersion} is retired`);
      return (codeVersion.tables.get(registry.name) ?? EMPTY_TABLE) as RegistryTable<V>;
    };
    return {
      table,
      get: (key, ctx) => table(ctx).get(key),
      subscribe: (listener) => {
        const set = entryOf(this.#subscribers, registry.name, () => new Set<TableListener>());
        const wrapped = listener as TableListener;
        set.add(wrapped);
        wrapped(table(), this.current.id);
        return () => set.delete(wrapped);
      },
    };
  }

  buildTables(
    entries: Iterable<readonly [ObjectImpl, Decls]>,
  ): Map<string, RegistryTable<unknown>> {
    const byRegistry = new Map<string, Map<string, { value: unknown; object: ObjectImpl }>>();
    for (const [object, decls] of entries) {
      for (const { registry, key, value } of decls.registrations.values()) {
        const registryEntries = entryOf(
          byRegistry,
          registry.name,
          () => new Map<string, { value: unknown; object: ObjectImpl }>(),
        );
        const existing = registryEntries.get(key);
        if (existing !== undefined && existing.object !== object && registry.conflict === "error") {
          throw invalid(
            "registry_conflict",
            `${registry.name}: ${key} registered by ${existing.object.address} and ${object.address}`,
          );
        }
        registryEntries.set(key, { value, object });
        const order = entryOf(this.#order, registry.name, () => new Map<string, number>());
        if (!order.has(key)) order.set(key, order.size);
      }
    }
    const tables = new Map<string, RegistryTable<unknown>>();
    for (const [name, tableEntries] of byRegistry) {
      const order = this.#order.get(name)!;
      const sorted = [...tableEntries].sort(([a], [b]) => order.get(a)! - order.get(b)!);
      tables.set(name, new Map(sorted.map(([key, entry]) => [key, entry.value])));
    }
    return tables;
  }

  liveDecls(candidates = false): [ObjectImpl, Decls][] {
    return [...this.objects.values()]
      .filter((object) => object.status === "live" && (candidates || !object.deferredRuntime))
      .map((object) => [object, object.decls]);
  }

  checkRegistrations(object: ObjectImpl, decls: Decls): void {
    if (decls.registrations.size === 0) return;
    this.buildTables([...this.liveDecls().filter(([other]) => other !== object), [object, decls]]);
  }

  registriesChanged(including?: ObjectImpl): void {
    const entries = this.liveDecls().filter(([object]) => object !== including);
    if (including !== undefined) entries.push([including, including.decls]);
    this.installTables(this.current, this.buildTables(entries));
  }

  installTables(
    codeVersion: CodeVersionState,
    tables: Map<string, RegistryTable<unknown>>,
    all = false,
  ): void {
    const before = codeVersion.tables;
    codeVersion.tables = tables;
    if (codeVersion !== this.current) return;
    for (const [name, listeners] of this.#subscribers) {
      const next = tables.get(name) ?? EMPTY_TABLE;
      if (!all && sameTable(before.get(name) ?? EMPTY_TABLE, next)) continue;
      const current = [...listeners];
      enqueue(() => {
        for (const listener of current) {
          try {
            listener(next, codeVersion.id);
          } catch (error) {
            this.report(error);
          }
        }
      });
    }
  }
}
