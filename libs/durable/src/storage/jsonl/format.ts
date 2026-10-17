import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import type { FileError } from "../../env/index.ts";
import { seqFromNumber } from "../../ids.ts";
import type {
  DocumentContent,
  DocumentCreate,
  DocumentId,
  Seq,
  StorageWrite,
  TaskId,
  TaskRecord,
} from "../../types.ts";
import { JsonlCorruptionError } from "./corruption-error.ts";

export const FORMAT_VERSION = 1;
export const MAIN_FILE = "main.jsonl";

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export type MainOperation =
  | Extract<
      StorageWrite,
      { readonly type: "conversation" | "entry" | "submission" | "document.retire" }
    >
  | { readonly type: "task"; readonly value: StoredTask }
  | { readonly type: "task.sidecar"; readonly id: TaskId; readonly ordinal: number }
  | { readonly type: "document.create"; readonly record: DocumentCreate; readonly ordinal: number }
  | { readonly type: "document.change"; readonly id: DocumentId; readonly ordinal: number };

export type MainMarker = {
  readonly format: typeof FORMAT_VERSION;
  readonly type: "commit";
  readonly seq: Seq;
  readonly writes: readonly MainOperation[];
};

export type SidecarPayload =
  | { readonly type: "task"; readonly value: StoredTask }
  | { readonly type: "document"; readonly id: DocumentId; readonly content: DocumentContent };

export type SidecarRecord = {
  readonly format: typeof FORMAT_VERSION;
  readonly type: "record";
  readonly seq: Seq;
  readonly ordinal: number;
  readonly payload: SidecarPayload;
};

export type ParsedLine<T> = {
  readonly value: T;
  readonly start: number;
};

export type ParsedFile<T> = {
  readonly path: string;
  readonly lines: readonly ParsedLine<T>[];
};

export type EncodedCommit = {
  readonly marker: string;
  readonly sidecars: ReadonlyMap<string, string>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value);

const isOrdinal = (value: unknown): boolean => isSafeInteger(value) && value >= 0;

export const sidecarFileName: {
  (id: DocumentId | TaskId): (kind: "doc" | "task") => string;
  (kind: "doc" | "task", id: DocumentId | TaskId): string;
} = Function.dual(
  2,
  (kind: "doc" | "task", id: DocumentId | TaskId): string => `${kind}-${id}.jsonl`,
);

export const isSidecarFileName = (name: string): boolean =>
  /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl$/u.test(name);

export const isReclaimFileName = (name: string): boolean =>
  /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl\.reclaim$/u.test(name);

export const isCurrentOnly = (record: DocumentCreate): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

export const sidecarKey: {
  (seq: Seq, ordinal: number): (file: string) => string;
  (file: string, seq: Seq, ordinal: number): string;
} = Function.dual(3, (file: string, seq: Seq, ordinal: number): string =>
  JSON.stringify([file, seq, ordinal]),
);

export const jsonLine = (value: MainMarker | SidecarRecord): string => `${JSON.stringify(value)}\n`;

export const errorFromFile: {
  (error: FileError): (action: string) => Error;
  (action: string, error: FileError): Error;
} = Function.dual(
  2,
  (action: string, error: FileError): Error =>
    new Error(`JSONL ${action} failed: ${error.message}`, { cause: error }),
);

const parseJson = (text: string, description: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new JsonlCorruptionError(
      `Malformed complete ${description}`,
      error instanceof Error ? error : undefined,
    );
  }
};

const hasRecordId = (value: Record<string, unknown>): boolean =>
  isObject(value["value"]) && isSafeInteger(value["value"]["id"]);

const taskState = (value: Record<string, unknown>): unknown => {
  const task = value["value"];
  return isObject(task) ? task["state"] : undefined;
};

const hasTaskStatus = (value: Record<string, unknown>, terminal: boolean): boolean => {
  const state = taskState(value);
  return hasRecordId(value) && isObject(state) && (state["status"] === "terminal") === terminal;
};

const isTerminalTask = (value: Record<string, unknown>): boolean => hasTaskStatus(value, true);

const operationChecks: Readonly<
  Record<string, readonly [check: (value: Record<string, unknown>) => boolean, label: string]>
> = {
  conversation: [hasRecordId, "Invalid conversation write"],
  entry: [hasRecordId, "Invalid entry write"],
  submission: [hasRecordId, "Invalid submission write"],
  task: [isTerminalTask, "Invalid terminal task write"],
  "document.retire": [(value) => isSafeInteger(value["id"]), "Invalid document retirement"],
  "task.sidecar": [
    (value) => isSafeInteger(value["id"]) && isOrdinal(value["ordinal"]),
    "Invalid task sidecar write",
  ],
  "document.create": [
    (value) =>
      isObject(value["record"]) &&
      isSafeInteger(value["record"]["id"]) &&
      isOrdinal(value["ordinal"]),
    "Invalid document creation",
  ],
  "document.change": [
    (value) => isSafeInteger(value["id"]) && isOrdinal(value["ordinal"]),
    "Invalid document change",
  ],
};

const validateMainOperation = (value: unknown, description: string): MainOperation => {
  if (!isObject(value) || typeof value["type"] !== "string") {
    throw new JsonlCorruptionError(`Invalid write in ${description}`);
  }
  const check = Object.hasOwn(operationChecks, value["type"])
    ? operationChecks[value["type"]]
    : undefined;
  if (check === undefined) throw new JsonlCorruptionError(`Unknown write type in ${description}`);
  if (!check[0](value)) throw new JsonlCorruptionError(`${check[1]} in ${description}`);
  return value as MainOperation;
};

export const parseMainMarker: {
  (line: number): (text: string) => MainMarker;
  (text: string, line: number): MainMarker;
} = Function.dual(2, (text: string, line: number): MainMarker => {
  const description = `${MAIN_FILE} line ${line}`;
  const value = parseJson(text, description);
  if (
    !isObject(value) ||
    value["format"] !== FORMAT_VERSION ||
    value["type"] !== "commit" ||
    !isSafeInteger(value["seq"]) ||
    value["seq"] < 1 ||
    !Array.isArray(value["writes"])
  ) {
    throw new JsonlCorruptionError(`Invalid commit marker in ${description}`);
  }
  return {
    format: FORMAT_VERSION,
    type: "commit",
    seq: seqFromNumber(value["seq"]),
    writes: value["writes"].map((write) => validateMainOperation(write, description)),
  };
});

const validateDocumentContent = (value: unknown, description: string): DocumentContent => {
  if (!isObject(value) || !isSafeInteger(value["version"]) || value["version"] < 1) {
    throw new JsonlCorruptionError(`Invalid document content in ${description}`);
  }
  if (value["kind"] === "base" && isObject(value["value"])) return value as DocumentContent;
  if (value["kind"] === "delta" && Array.isArray(value["ops"])) return value as DocumentContent;
  throw new JsonlCorruptionError(`Invalid document content in ${description}`);
};

const isRecordShape = (value: unknown): value is Record<string, unknown> =>
  isObject(value) &&
  value["format"] === FORMAT_VERSION &&
  value["type"] === "record" &&
  isSafeInteger(value["seq"]) &&
  value["seq"] >= 1 &&
  isOrdinal(value["ordinal"]) &&
  isObject(value["payload"]) &&
  typeof value["payload"]["type"] === "string";

const validatePayload = (payload: Record<string, unknown>, description: string): void => {
  if (payload["type"] === "task") {
    if (!hasTaskStatus(payload, false)) {
      throw new JsonlCorruptionError(`Invalid live task record in ${description}`);
    }
  } else if (payload["type"] === "document") {
    if (!isSafeInteger(payload["id"])) {
      throw new JsonlCorruptionError(`Invalid document record in ${description}`);
    }
    validateDocumentContent(payload["content"], description);
  } else {
    throw new JsonlCorruptionError(`Unknown sidecar record type in ${description}`);
  }
};

export const parseSidecarRecord: {
  (file: string, line: number): (text: string) => SidecarRecord;
  (text: string, file: string, line: number): SidecarRecord;
} = Function.dual(3, (text: string, file: string, line: number): SidecarRecord => {
  const description = `${file} line ${line}`;
  const value = parseJson(text, description);
  if (!isRecordShape(value)) {
    throw new JsonlCorruptionError(`Invalid sidecar record in ${description}`);
  }
  validatePayload(value["payload"] as Record<string, unknown>, description);
  return value as SidecarRecord;
});
