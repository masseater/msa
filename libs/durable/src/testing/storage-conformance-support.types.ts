import type chordTypes from "@msa/chord/index.types";
import type { Effect } from "effect";

import type typesModule from "../types.types.ts";

declare namespace storageConformanceSupportTypes {
  type StoredTask = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type Identified = { readonly id: number };

  type AssertionResult = {
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toBeGreaterThan(expected: number): void;
    toBeUndefined(): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatchObject(expected: unknown): void;
    readonly rejects: { toThrow(messageIncludes: string): Effect.Effect<void> };
  };

  type Expect = (actual: unknown) => AssertionResult;

  interface StorageCaseSpec {
    readonly name: string;
    readonly test: (storage: typesModule.Storage, expect: Expect) => Effect.Effect<void>;
  }
}

export type { storageConformanceSupportTypes as default };
