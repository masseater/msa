import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type { ConversationId, DocumentId, JsonObject, Seq, TaskId } from "./ids.ts";

export type LatestConversationSemantics = {
  readonly scope: "conversation";
  readonly history: "latest";
  readonly fork: "current" | "initial";
};

export type RewindableConversationSemantics = {
  readonly scope: "conversation";
  readonly history: "rewindable";
  readonly fork: "asOf" | "current" | "initial";
};

export type DocumentSemantics =
  | { readonly scope: "session"; readonly history?: never; readonly fork?: never }
  | LatestConversationSemantics
  | RewindableConversationSemantics
  | { readonly scope: "task"; readonly history?: never; readonly fork?: never };

export type CheckpointInfo = {
  readonly deltasSinceBase: number;
};

export type CommonDocDefinition<T extends JsonObject> = {
  readonly kind: string;
  readonly version: number;
  initial(): T;
  migrate?(value: JsonObject, fromVersion: number): T;
  checkpointWhen?(value: Readonly<T>, ops: readonly Op[], info: CheckpointInfo): boolean;
};

export type DocDefinition<T extends JsonObject> = CommonDocDefinition<T> & DocumentSemantics;

export type DocFamilyDefinition<T extends JsonObject, I extends JsonValue> = Omit<
  CommonDocDefinition<T>,
  "initial"
> &
  DocumentSemantics & {
    readonly family: true;
    initial(seed: I): T;
  };

declare const docType: unique symbol;

export interface DocToken<T extends JsonObject, D extends DocDefinition<T>> {
  readonly definition: D;
  readonly [docType]?: T;
}

export interface DocFamilyToken<
  T extends JsonObject,
  I extends JsonValue,
  D extends DocFamilyDefinition<T, I>,
> {
  readonly definition: D;
  readonly [docType]?: T;
}

export type SessionDocToken<T extends JsonObject> = DocToken<
  T,
  CommonDocDefinition<T> & { readonly scope: "session" }
>;
export type ConversationDocToken<T extends JsonObject> = DocToken<
  T,
  CommonDocDefinition<T> & (LatestConversationSemantics | RewindableConversationSemantics)
>;
export type RewindableConversationDocToken<T extends JsonObject> = DocToken<
  T,
  CommonDocDefinition<T> & RewindableConversationSemantics
>;
export type TaskDocToken<T extends JsonObject> = DocToken<
  T,
  CommonDocDefinition<T> & { readonly scope: "task" }
>;

export type SessionDocFamilyToken<T extends JsonObject, I extends JsonValue> = DocFamilyToken<
  T,
  I,
  DocFamilyDefinition<T, I> & { readonly scope: "session" }
>;
export type ConversationDocFamilyToken<T extends JsonObject, I extends JsonValue> = DocFamilyToken<
  T,
  I,
  DocFamilyDefinition<T, I> & (LatestConversationSemantics | RewindableConversationSemantics)
>;
export type RewindableConversationDocFamilyToken<
  T extends JsonObject,
  I extends JsonValue,
> = DocFamilyToken<T, I, DocFamilyDefinition<T, I> & RewindableConversationSemantics>;
export type TaskDocFamilyToken<T extends JsonObject, I extends JsonValue> = DocFamilyToken<
  T,
  I,
  DocFamilyDefinition<T, I> & { readonly scope: "task" }
>;

export type DocumentRecord = {
  readonly id: DocumentId;
  readonly kind: string;
  readonly key?: string;
  readonly createdAt: Seq;
  readonly retiredAt?: Seq;
} & (
  | {
      readonly scope: { readonly kind: "session" };
      readonly history?: never;
      readonly fork?: never;
    }
  | ({
      readonly scope: { readonly kind: "conversation"; readonly conversationId: ConversationId };
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
      readonly scope: { readonly kind: "task"; readonly taskId: TaskId };
      readonly history?: never;
      readonly fork?: never;
    }
);

export type DocumentCreate = DocumentRecord extends infer Record
  ? Record extends DocumentRecord
    ? Omit<Record, "createdAt" | "retiredAt">
    : never
  : never;

export type DocumentPoint = Seq | "current";

export type DocumentAddress = {
  readonly kind: string;
  readonly scope: DocumentRecord["scope"];
  readonly key?: string;
};

export type DocumentQuery = {
  readonly scope: DocumentRecord["scope"];
  readonly at: DocumentPoint;
  readonly kind?: string;
};

export type DocumentContent =
  | {
      readonly version: number;
      readonly kind: "base";
      readonly value: JsonObject;
    }
  | {
      readonly version: number;
      readonly kind: "delta";
      readonly ops: readonly Op[];
    };

export type DocumentCopySource = {
  readonly id: DocumentId;
  readonly at: DocumentPoint;
};

export type StoredDocument = {
  readonly record: DocumentRecord;
  readonly version: number;
  readonly value: JsonObject;
  readonly deltasSinceBase: number;
};
