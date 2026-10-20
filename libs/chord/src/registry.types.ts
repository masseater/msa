import type typesModule from "./types.types.ts";

declare namespace registryTypes {
  interface Registry<V> {
    readonly name: string;
    readonly conflict: "error" | "last";
    readonly value?: V;
  }

  type RegistryTable<V> = ReadonlyMap<string, V>;

  interface RegistryView<V> {
    table(ctx?: typesModule.Ctx): RegistryTable<V>;
    get(key: string, ctx?: typesModule.Ctx): V | undefined;
    subscribe(listener: (table: RegistryTable<V>, codeVersion: number) => void): () => void;
  }

  interface Registration {
    readonly registry: Registry<unknown>;
    readonly key: string;
    readonly value: unknown;
  }
}

export type { registryTypes as default };
