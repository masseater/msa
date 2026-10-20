import type { JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { Function } from "effect";

import type documentsTypes from "./documents.types.ts";
import type dualTypes from "./dual.ts";
import ids from "./ids.ts";
import type typesModule from "./types.types.ts";

const { idFromNumber } = ids;

type FamilyInput<T extends typesModule.JsonObject, I extends JsonValue> = Omit<
  typesModule.CommonDocDefinition<T>,
  "initial"
> & {
  readonly family: true;
  initial(seed: I): T;
};

function defineDoc<T extends typesModule.JsonObject>(
  definition: typesModule.CommonDocDefinition<T> & { readonly scope: "session" },
): typesModule.SessionDocToken<T>;
function defineDoc<T extends typesModule.JsonObject>(
  definition: typesModule.CommonDocDefinition<T> & typesModule.LatestConversationSemantics,
): typesModule.ConversationDocToken<T>;
function defineDoc<T extends typesModule.JsonObject>(
  definition: typesModule.CommonDocDefinition<T> & typesModule.RewindableConversationSemantics,
): typesModule.RewindableConversationDocToken<T>;
function defineDoc<T extends typesModule.JsonObject>(
  definition: typesModule.CommonDocDefinition<T> & { readonly scope: "task" },
): typesModule.TaskDocToken<T>;
function defineDoc<T extends typesModule.JsonObject>(
  definition: typesModule.DocDefinition<T>,
): typesModule.DocToken<T, typesModule.DocDefinition<T>> {
  validateDefinition(definition);
  return { definition };
}

function defineDocFamily<T extends typesModule.JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & { readonly scope: "session" },
): typesModule.SessionDocFamilyToken<T, I>;
function defineDocFamily<T extends typesModule.JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & typesModule.LatestConversationSemantics,
): typesModule.ConversationDocFamilyToken<T, I>;
function defineDocFamily<T extends typesModule.JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & typesModule.RewindableConversationSemantics,
): typesModule.RewindableConversationDocFamilyToken<T, I>;
function defineDocFamily<T extends typesModule.JsonObject, I extends JsonValue>(
  definition: FamilyInput<T, I> & { readonly scope: "task" },
): typesModule.TaskDocFamilyToken<T, I>;
function defineDocFamily<T extends typesModule.JsonObject, I extends JsonValue>(
  definition: typesModule.DocFamilyDefinition<T, I>,
): typesModule.DocFamilyToken<T, I, typesModule.DocFamilyDefinition<T, I>> {
  validateDefinition(definition);
  return { definition };
}

function validateDefinition(definition: documentsTypes.AnyDocDefinition): void {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new TypeError(`Document ${definition.kind} version must be a positive integer`);
  }
}

const resolveAddress: dualTypes.Dual2<
  documentsTypes.AnyDocDefinition,
  readonly unknown[],
  documentsTypes.ResolvedAddress
> = Function.dual(
  2,
  (
    definition: documentsTypes.AnyDocDefinition,
    args: readonly unknown[],
  ): documentsTypes.ResolvedAddress => {
    let index = 0;
    let scope: typesModule.DocumentAddress["scope"];
    switch (definition.scope) {
      case "session":
        scope = { kind: "session" };
        break;
      case "conversation":
        scope = {
          conversationId: ownerId<typesModule.ConversationId>(args[index++], definition),
          kind: "conversation",
        };
        break;
      case "task":
        scope = { kind: "task", taskId: ownerId<typesModule.TaskId>(args[index++], definition) };
        break;
    }
    const key = definition.family === true ? (args[index++] as string) : undefined;
    const address: typesModule.DocumentAddress =
      key === undefined ? { kind: definition.kind, scope } : { key, kind: definition.kind, scope };
    return { address, id: addressId(address), nextArgument: index };
  },
);

function ownerId<I extends typesModule.Id<string>>(
  value: unknown,
  definition: documentsTypes.AnyDocDefinition,
): I {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`Document ${definition.kind} requires a ${definition.scope} ID`);
  }
  return idFromNumber<I>(value);
}

function addressId(address: typesModule.DocumentAddress): string {
  const owner =
    address.scope.kind === "session"
      ? null
      : address.scope.kind === "conversation"
        ? address.scope.conversationId
        : address.scope.taskId;
  return JSON.stringify([address.kind, address.scope.kind, owner, address.key ?? null]);
}

const documentCreate: dualTypes.Dual3<
  documentsTypes.AnyDocDefinition,
  typesModule.DocumentAddress,
  typesModule.DocumentId,
  typesModule.DocumentCreate
> = Function.dual(
  3,
  (
    definition: documentsTypes.AnyDocDefinition,
    address: typesModule.DocumentAddress,
    id: typesModule.DocumentId,
  ): typesModule.DocumentCreate => {
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
          fork: definition.fork!,
          history: definition.history!,
          scope: address.scope,
        } as typesModule.DocumentCreate;
    }
  },
);

const checkRecordScope: dualTypes.Dual2<
  documentsTypes.AnyDocDefinition,
  typesModule.DocumentCreate | typesModule.DocumentRecord,
  void
> = Function.dual(
  2,
  (
    definition: documentsTypes.AnyDocDefinition,
    record: typesModule.DocumentCreate | typesModule.DocumentRecord,
  ): void => {
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

const checkRecordVersion: dualTypes.Dual3<
  documentsTypes.AnyDocDefinition,
  typesModule.DocumentCreate | typesModule.DocumentRecord,
  number,
  void
> = Function.dual(
  3,
  (
    definition: documentsTypes.AnyDocDefinition,
    record: typesModule.DocumentCreate | typesModule.DocumentRecord,
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

const materializeDocument: dualTypes.Dual2<
  documentsTypes.AnyDocDefinition,
  typesModule.StoredDocument,
  typesModule.JsonObject
> = Function.dual(
  2,
  (
    definition: documentsTypes.AnyDocDefinition,
    stored: typesModule.StoredDocument,
  ): typesModule.JsonObject =>
    materializeDocumentValue(definition, stored.record, stored.version, stored.value),
);

const materializeDocumentValue: dualTypes.Dual4<
  documentsTypes.AnyDocDefinition,
  typesModule.DocumentCreate | typesModule.DocumentRecord,
  number,
  typesModule.JsonObject,
  typesModule.JsonObject
> = Function.dual(
  4,
  (
    definition: documentsTypes.AnyDocDefinition,
    record: typesModule.DocumentCreate | typesModule.DocumentRecord,
    version: number,
    value: typesModule.JsonObject,
  ): typesModule.JsonObject => {
    checkRecordScope(definition, record);
    checkRecordVersion(definition, record, version);
    if (version === definition.version) return value;
    return copyJson(definition.migrate!(value, version)) as typesModule.JsonObject;
  },
);

const documents = {
  addressId,
  checkRecordScope,
  checkRecordVersion,
  defineDoc,
  defineDocFamily,
  documentCreate,
  materializeDocument,
  materializeDocumentValue,
  resolveAddress,
};

export default documents;
