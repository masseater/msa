import { Function } from "effect";

import type envTypes from "../../env/index.types.ts";
import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import JsonlCorruptionError from "./corruption-error.ts";
import type formatTypes from "./format.types.ts";

const { seqFromNumber } = ids;

const FORMAT_VERSION = 1;
const MAIN_FILE = "main.jsonl";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value);

const isOrdinal = (value: unknown): boolean => isSafeInteger(value) && value >= 0;

const sidecarFileName: {
  (id: typesModule.DocumentId | typesModule.TaskId): (kind: "doc" | "task") => string;
  (kind: "doc" | "task", id: typesModule.DocumentId | typesModule.TaskId): string;
} = Function.dual(
  2,
  (kind: "doc" | "task", id: typesModule.DocumentId | typesModule.TaskId): string =>
    `${kind}-${id}.jsonl`,
);

const isSidecarFileName = (name: string): boolean =>
  /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl$/u.test(name);

const isReclaimFileName = (name: string): boolean =>
  /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl\.reclaim$/u.test(name);

const isCurrentOnly = (record: typesModule.DocumentCreate): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

const sidecarKey: {
  (seq: typesModule.Seq, ordinal: number): (file: string) => string;
  (file: string, seq: typesModule.Seq, ordinal: number): string;
} = Function.dual(3, (file: string, seq: typesModule.Seq, ordinal: number): string =>
  JSON.stringify([file, seq, ordinal]),
);

const jsonLine = (value: formatTypes.MainMarker | formatTypes.SidecarRecord): string =>
  `${JSON.stringify(value)}\n`;

const errorFromFile: {
  (error: envTypes.FileError): (action: string) => Error;
  (action: string, error: envTypes.FileError): Error;
} = Function.dual(
  2,
  (action: string, error: envTypes.FileError): Error =>
    new Error(`JSONL ${action} failed: ${error.message}`, { cause: error }),
);

const parseJson = (text: string, description: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw JsonlCorruptionError.create(
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
  "document.change": [
    (value) => isSafeInteger(value["id"]) && isOrdinal(value["ordinal"]),
    "Invalid document change",
  ],
  "document.create": [
    (value) =>
      isObject(value["record"]) &&
      isSafeInteger(value["record"]["id"]) &&
      isOrdinal(value["ordinal"]),
    "Invalid document creation",
  ],
  "document.retire": [(value) => isSafeInteger(value["id"]), "Invalid document retirement"],
  entry: [hasRecordId, "Invalid entry write"],
  submission: [hasRecordId, "Invalid submission write"],
  task: [isTerminalTask, "Invalid terminal task write"],
  "task.sidecar": [
    (value) => isSafeInteger(value["id"]) && isOrdinal(value["ordinal"]),
    "Invalid task sidecar write",
  ],
};

const validateMainOperation = (value: unknown, description: string): formatTypes.MainOperation => {
  if (!isObject(value) || typeof value["type"] !== "string") {
    throw JsonlCorruptionError.create(`Invalid write in ${description}`);
  }
  const check = Object.hasOwn(operationChecks, value["type"])
    ? operationChecks[value["type"]]
    : undefined;
  if (check === undefined)
    throw JsonlCorruptionError.create(`Unknown write type in ${description}`);
  if (!check[0](value)) throw JsonlCorruptionError.create(`${check[1]} in ${description}`);
  return value as formatTypes.MainOperation;
};

const parseMainMarker: {
  (line: number): (text: string) => formatTypes.MainMarker;
  (text: string, line: number): formatTypes.MainMarker;
} = Function.dual(2, (text: string, line: number): formatTypes.MainMarker => {
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
    throw JsonlCorruptionError.create(`Invalid commit marker in ${description}`);
  }
  return {
    format: FORMAT_VERSION,
    seq: seqFromNumber(value["seq"]),
    type: "commit",
    writes: value["writes"].map((write) => validateMainOperation(write, description)),
  };
});

const validateDocumentContent = (
  value: unknown,
  description: string,
): typesModule.DocumentContent => {
  if (!isObject(value) || !isSafeInteger(value["version"]) || value["version"] < 1) {
    throw JsonlCorruptionError.create(`Invalid document content in ${description}`);
  }
  if (value["kind"] === "base" && isObject(value["value"]))
    return value as typesModule.DocumentContent;
  if (value["kind"] === "delta" && Array.isArray(value["ops"]))
    return value as typesModule.DocumentContent;
  throw JsonlCorruptionError.create(`Invalid document content in ${description}`);
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
      throw JsonlCorruptionError.create(`Invalid live task record in ${description}`);
    }
  } else if (payload["type"] === "document") {
    if (!isSafeInteger(payload["id"])) {
      throw JsonlCorruptionError.create(`Invalid document record in ${description}`);
    }
    validateDocumentContent(payload["content"], description);
  } else {
    throw JsonlCorruptionError.create(`Unknown sidecar record type in ${description}`);
  }
};

const parseSidecarRecord: {
  (file: string, line: number): (text: string) => formatTypes.SidecarRecord;
  (text: string, file: string, line: number): formatTypes.SidecarRecord;
} = Function.dual(3, (text: string, file: string, line: number): formatTypes.SidecarRecord => {
  const description = `${file} line ${line}`;
  const value = parseJson(text, description);
  if (!isRecordShape(value)) {
    throw JsonlCorruptionError.create(`Invalid sidecar record in ${description}`);
  }
  validatePayload(value["payload"] as Record<string, unknown>, description);
  return value as formatTypes.SidecarRecord;
});

const formatModule = {
  FORMAT_VERSION,
  MAIN_FILE,
  errorFromFile,
  isCurrentOnly,
  isReclaimFileName,
  isSidecarFileName,
  jsonLine,
  parseMainMarker,
  parseSidecarRecord,
  sidecarFileName,
  sidecarKey,
};

export default formatModule;
