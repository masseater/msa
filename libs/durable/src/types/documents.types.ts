import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type documents from "./documents.ts";
import type idsTypes from "./ids.types.ts";

declare namespace documentsTypes {
  type LatestConversationSemantics = {
    readonly scope: "conversation";
    readonly history: "latest";
    readonly fork: "current" | "initial";
  };

  type RewindableConversationSemantics = {
    readonly scope: "conversation";
    readonly history: "rewindable";
    readonly fork: "asOf" | "current" | "initial";
  };

  type DocumentSemantics =
    | { readonly scope: "session"; readonly history?: never; readonly fork?: never }
    | LatestConversationSemantics
    | RewindableConversationSemantics
    | { readonly scope: "task"; readonly history?: never; readonly fork?: never };

  type CheckpointInfo = {
    readonly deltasSinceBase: number;
  };

  type CommonDocDefinition<T extends idsTypes.JsonObject> = {
    readonly kind: string;
    readonly version: number;
    initial(): T;
    migrate?(value: idsTypes.JsonObject, fromVersion: number): T;
    checkpointWhen?(value: Readonly<T>, ops: readonly Op[], info: CheckpointInfo): boolean;
  };

  type DocDefinition<T extends idsTypes.JsonObject> = CommonDocDefinition<T> & DocumentSemantics;

  type DocFamilyDefinition<T extends idsTypes.JsonObject, I extends JsonValue> = Omit<
    CommonDocDefinition<T>,
    "initial"
  > &
    DocumentSemantics & {
      readonly family: true;
      initial(seed: I): T;
    };

  interface DocToken<T extends idsTypes.JsonObject, D extends DocDefinition<T>> {
    readonly definition: D;
    readonly [documents.docType]?: T;
  }

  interface DocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends JsonValue,
    D extends DocFamilyDefinition<T, I>,
  > {
    readonly definition: D;
    readonly [documents.docType]?: T;
  }

  type SessionDocToken<T extends idsTypes.JsonObject> = DocToken<
    T,
    CommonDocDefinition<T> & { readonly scope: "session" }
  >;

  type ConversationDocToken<T extends idsTypes.JsonObject> = DocToken<
    T,
    CommonDocDefinition<T> & (LatestConversationSemantics | RewindableConversationSemantics)
  >;

  type RewindableConversationDocToken<T extends idsTypes.JsonObject> = DocToken<
    T,
    CommonDocDefinition<T> & RewindableConversationSemantics
  >;

  type TaskDocToken<T extends idsTypes.JsonObject> = DocToken<
    T,
    CommonDocDefinition<T> & { readonly scope: "task" }
  >;

  type SessionDocFamilyToken<T extends idsTypes.JsonObject, I extends JsonValue> = DocFamilyToken<
    T,
    I,
    DocFamilyDefinition<T, I> & { readonly scope: "session" }
  >;

  type ConversationDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends JsonValue,
  > = DocFamilyToken<
    T,
    I,
    DocFamilyDefinition<T, I> & (LatestConversationSemantics | RewindableConversationSemantics)
  >;

  type RewindableConversationDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends JsonValue,
  > = DocFamilyToken<T, I, DocFamilyDefinition<T, I> & RewindableConversationSemantics>;

  type TaskDocFamilyToken<T extends idsTypes.JsonObject, I extends JsonValue> = DocFamilyToken<
    T,
    I,
    DocFamilyDefinition<T, I> & { readonly scope: "task" }
  >;

  type DocumentRecord = {
    readonly id: idsTypes.DocumentId;
    readonly kind: string;
    readonly key?: string;
    readonly createdAt: idsTypes.Seq;
    readonly retiredAt?: idsTypes.Seq;
  } & (
    | {
        readonly scope: { readonly kind: "session" };
        readonly history?: never;
        readonly fork?: never;
      }
    | ({
        readonly scope: {
          readonly kind: "conversation";
          readonly conversationId: idsTypes.ConversationId;
        };
      } & (
        | {
            readonly history: "latest";
            readonly fork: "current" | "initial";
          }
        | {
            readonly history: "rewindable";
            readonly fork: "asOf" | "current" | "initial";
          }
      ))
    | {
        readonly scope: { readonly kind: "task"; readonly taskId: idsTypes.TaskId };
        readonly history?: never;
        readonly fork?: never;
      }
  );

  type DocumentCreate = DocumentRecord extends infer Record
    ? Record extends DocumentRecord
      ? Omit<Record, "createdAt" | "retiredAt">
      : never
    : never;

  type DocumentPoint = idsTypes.Seq | "current";

  type DocumentAddress = {
    readonly kind: string;
    readonly scope: DocumentRecord["scope"];
    readonly key?: string;
  };

  type DocumentQuery = {
    readonly scope: DocumentRecord["scope"];
    readonly at: DocumentPoint;
    readonly kind?: string;
  };

  type DocumentContent =
    | {
        readonly version: number;
        readonly kind: "base";
        readonly value: idsTypes.JsonObject;
      }
    | {
        readonly version: number;
        readonly kind: "delta";
        readonly ops: readonly Op[];
      };

  type DocumentCopySource = {
    readonly id: idsTypes.DocumentId;
    readonly at: DocumentPoint;
  };

  type StoredDocument = {
    readonly record: DocumentRecord;
    readonly version: number;
    readonly value: idsTypes.JsonObject;
    readonly deltasSinceBase: number;
  };
}

export type { documentsTypes as default };
