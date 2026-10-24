import type declsTypes from "./decls.types.ts";
import errorsModule from "./errors.ts";
import HostRoots from "./host-roots.ts";
import type hostTypesModule from "./host-types.types.ts";
import type objectTypes from "./object.types.ts";
import publish from "./publish.ts";
import type registryTypes from "./registry.types.ts";
import type typesModule from "./types.types.ts";

const { ChordError, invalid } = errorsModule;
const { enqueue } = publish;

type TableListener = (table: registryTypes.RegistryTable<unknown>, codeVersion: number) => void;

const EMPTY_TABLE: registryTypes.RegistryTable<never> = new Map<string, never>();

const sameTable = (
  a: registryTypes.RegistryTable<unknown>,
  b: registryTypes.RegistryTable<unknown>,
): boolean => {
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

export default abstract class HostRegistries extends HostRoots {
  readonly #order = new Map<string, Map<string, number>>();
  readonly #subscribers = new Map<string, Set<TableListener>>();

  registry<V>(registry: registryTypes.Registry<V>): registryTypes.RegistryView<V> {
    const table = (ctx?: typesModule.Ctx): registryTypes.RegistryTable<V> => {
      const codeVersion = ctx === undefined ? this.current : this.codeVersions.get(ctx.codeVersion);
      if (codeVersion === undefined)
        throw ChordError.create("superseded", `code version ${ctx?.codeVersion} is retired`);
      return (codeVersion.tables.get(registry.name) ??
        EMPTY_TABLE) as registryTypes.RegistryTable<V>;
    };
    return {
      get: (key, ctx) => table(ctx).get(key),
      subscribe: (listener) => {
        const set = entryOf(this.#subscribers, registry.name, () => new Set<TableListener>());
        const wrapped = listener as TableListener;
        set.add(wrapped);
        wrapped(table(), this.current.id);
        return () => set.delete(wrapped);
      },
      table,
    };
  }

  buildTables(
    entries: Iterable<readonly [objectTypes.ObjectImpl, declsTypes.Decls]>,
  ): Map<string, registryTypes.RegistryTable<unknown>> {
    const byRegistry = new Map<
      string,
      Map<string, { value: unknown; object: objectTypes.ObjectImpl }>
    >();
    for (const [object, decls] of entries) {
      for (const { registry, key, value } of decls.registrations.values()) {
        const registryEntries = entryOf(
          byRegistry,
          registry.name,
          () => new Map<string, { value: unknown; object: objectTypes.ObjectImpl }>(),
        );
        const existing = registryEntries.get(key);
        if (existing !== undefined && existing.object !== object && registry.conflict === "error") {
          throw invalid(
            "registry_conflict",
            `${registry.name}: ${key} registered by ${existing.object.address} and ${object.address}`,
          );
        }
        registryEntries.set(key, { object, value });
        const order = entryOf(this.#order, registry.name, () => new Map<string, number>());
        if (!order.has(key)) order.set(key, order.size);
      }
    }
    const tables = new Map<string, registryTypes.RegistryTable<unknown>>();
    for (const [name, tableEntries] of byRegistry) {
      const order = this.#order.get(name)!;
      const sorted = [...tableEntries].sort(([a], [b]) => order.get(a)! - order.get(b)!);
      tables.set(name, new Map(sorted.map(([key, entry]) => [key, entry.value])));
    }
    return tables;
  }

  liveDecls(candidates = false): [objectTypes.ObjectImpl, declsTypes.Decls][] {
    return [...this.objects.values()]
      .filter((object) => object.status === "live" && (candidates || !object.deferredRuntime))
      .map((object) => [object, object.decls]);
  }

  checkRegistrations(object: objectTypes.ObjectImpl, decls: declsTypes.Decls): void {
    if (decls.registrations.size === 0) return;
    this.buildTables([...this.liveDecls().filter(([other]) => other !== object), [object, decls]]);
  }

  registriesChanged(including?: objectTypes.ObjectImpl): void {
    const entries = this.liveDecls().filter(([object]) => object !== including);
    if (including !== undefined) entries.push([including, including.decls]);
    this.installTables(this.current, this.buildTables(entries));
  }

  installTables(
    codeVersion: hostTypesModule.CodeVersionState,
    tables: Map<string, registryTypes.RegistryTable<unknown>>,
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
