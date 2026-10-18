import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";
import { copyJson } from "@msa/chord/json";
import { Function } from "effect";

import type { Dual2, Dual3, Dual4 } from "./dual.ts";
import { idFromNumber } from "./ids.ts";
import type {
  CheckpointInfo,
  CommonDocDefinition,
  ConversationDocFamilyToken,
  ConversationDocToken,
  ConversationId,
  DocDefinition,
  DocFamilyDefinition,
  DocFamilyToken,
  DocToken,
  DocumentAddress,
  DocumentCreate,
  DocumentId,
  DocumentRecord,
  DocumentSemantics,
  Id,
  JsonObject,
  LatestConversationSemantics,
  RewindableConversationDocFamilyToken,
  RewindableConversationDocToken,
  RewindableConversationSemantics,
  SessionDocFamilyToken,
  SessionDocToken,
  StoredDocument,
  TaskDocFamilyToken,
  TaskDocToken,
  TaskId,
} from "./types.ts";

type FamilyInput<T extends JsonObject, I extends JsonValue> = Omit<
  CommonDocDefinition<T>,
  "initial"
> & {
  readonly family: true;
  initial(seed: I): T;
};

export function defineDoc<T extends JsonObject>(
  definition: CommonDocDefinition<T> & { readonly scope: "session" },
): SessionDocToken<T>;
export function defineDoc<T extends JsonObject>(
  definition: CommonDocDefinition<T> & LatestConversationSemantics,
): ConversationDocToken<T>;
export function defineDoc<T extends JsonObject>(
  definition: CommonDocDefinition<T> & RewindableConversationSemantics,
): RewindableConversationDocToken<T>;
export function defineDoc<T extends JsonObject>(
  definition: CommonDocDefinition<T> & { readonly scope: "task" },
): TaskDocToken<T>;
export function defineDoc<T extends JsonObject>(
  definition: DocDefinition<T>,
): DocToken<T, DocDefinition<T>> {
  validateDefinition(definition);
  return { definition };
}

export function defineDocFamily<T extends JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & { readonly scope: "session" },
): SessionDocFamilyToken<T, I>;
export function defineDocFamily<T extends JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & LatestConversationSemantics,
): ConversationDocFamilyToken<T, I>;
export function defineDocFamily<T extends JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & RewindableConversationSemantics,
): RewindableConversationDocFamilyToken<T, I>;
export function defineDocFamily<T extends JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & { readonly scope: "task" },
): TaskDocFamilyToken<T, I>;
export function defineDocFamily<T extends JsonObject, I extends JsonValue>(
  definition: DocFamilyDefinition<T, I>,
): DocFamilyToken<T, I, DocFamilyDefinition<T, I>> {
  validateDefinition(definition);
  return { definition };
}

export type AnyDocDefinition = DocumentSemantics & {
  readonly kind: string;
  readonly version: number;
  readonly family?: true;
  initial(seed?: JsonValue): JsonObject;
  migrate?(value: JsonObject, fromVersion: number): JsonObject;
  checkpointWhen?(value: Readonly<JsonObject>, ops: readonly Op[], info: CheckpointInfo): boolean;
};

export type AnyDocToken = { readonly definition: AnyDocDefinition };

function validateDefinition(definition: AnyDocDefinition): void {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new TypeError(`Document ${definition.kind} version must be a positive integer`);
  }
}

export type ResolvedAddress = {
  readonly address: DocumentAddress;
  readonly id: string;
  readonly nextArgument: number;
};

export const resolveAddress: Dual2<AnyDocDefinition, readonly unknown[], ResolvedAddress> =
  Function.dual(2, (definition: AnyDocDefinition, args: readonly unknown[]): ResolvedAddress => {
    let index = 0;
    let scope: DocumentAddress["scope"];
    switch (definition.scope) {
      case "session":
        scope = { kind: "session" };
        break;
      case "conversation":
        scope = {
          kind: "conversation",
          conversationId: ownerId<ConversationId>(args[index++], definition),
        };
        break;
      case "task":
        scope = { kind: "task", taskId: ownerId<TaskId>(args[index++], definition) };
        break;
    }
    const key = definition.family === true ? (args[index++] as string) : undefined;
    const address: DocumentAddress =
      key === undefined ? { kind: definition.kind, scope } : { kind: definition.kind, scope, key };
    return { address, id: addressId(address), nextArgument: index };
  });

function ownerId<I extends Id<string>>(value: unknown, definition: AnyDocDefinition): I {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`Document ${definition.kind} requires a ${definition.scope} ID`);
  }
  return idFromNumber<I>(value);
}

export function addressId(address: DocumentAddress): string {
  const owner =
    address.scope.kind === "session"
      ? null
      : address.scope.kind === "conversation"
        ? address.scope.conversationId
        : address.scope.taskId;
  return JSON.stringify([address.kind, address.scope.kind, owner, address.key ?? null]);
}

export const documentCreate: Dual3<AnyDocDefinition, DocumentAddress, DocumentId, DocumentCreate> =
  Function.dual(
    3,
    (definition: AnyDocDefinition, address: DocumentAddress, id: DocumentId): DocumentCreate => {
      const key = address.key === undefined ? {} : { key: address.key };
      switch (address.scope.kind) {
        case "session":
          return { id, kind: address.kind, ...key, scope: address.scope };
        case "task":
          return { id, kind: address.kind, ...key, scope: address.scope };
        case "conversation":
          return {
            id,
            kind: address.kind,
            ...key,
            scope: address.scope,
            history: definition.history!,
            fork: definition.fork!,
          } as DocumentCreate;
      }
    },
  );

export const checkRecordScope: Dual2<AnyDocDefinition, DocumentCreate | DocumentRecord, void> =
  Function.dual(
    2,
    (definition: AnyDocDefinition, record: DocumentCreate | DocumentRecord): void => {
      if (
        record.scope.kind !== definition.scope ||
        (record.scope.kind === "conversation" &&
          (record.history !== definition.history || record.fork !== definition.fork))
      ) {
        throw new TypeError(
          `Document ${record.id} (${record.kind}) does not match the supplied definition semantics`,
        );
      }
    },
  );

export const checkRecordVersion: Dual3<
  AnyDocDefinition,
  DocumentCreate | DocumentRecord,
  number,
  void
> = Function.dual(
  3,
  (
    definition: AnyDocDefinition,
    record: DocumentCreate | DocumentRecord,
    version: number,
  ): void => {
    if (version > definition.version) {
      throw new Error(
        `Document ${record.id} (${record.kind}) has newer version ${version} than ${definition.version}`,
      );
    }
    if (version < definition.version && definition.migrate === undefined) {
      throw new Error(
        `Document ${record.id} (${record.kind}) requires migration from version ${version}`,
      );
    }
  },
);

export const materializeDocument: Dual2<AnyDocDefinition, StoredDocument, JsonObject> =
  Function.dual(2, (definition: AnyDocDefinition, stored: StoredDocument): JsonObject =>
    materializeDocumentValue(definition, stored.record, stored.version, stored.value),
  );

export const materializeDocumentValue: Dual4<
  AnyDocDefinition,
  DocumentCreate | DocumentRecord,
  number,
  JsonObject,
  JsonObject
> = Function.dual(
  4,
  (
    definition: AnyDocDefinition,
    record: DocumentCreate | DocumentRecord,
    version: number,
    value: JsonObject,
  ): JsonObject => {
    checkRecordScope(definition, record);
    checkRecordVersion(definition, record, version);
    if (version === definition.version) return value;
    return copyJson(definition.migrate!(value, version)) as JsonObject;
  },
);
