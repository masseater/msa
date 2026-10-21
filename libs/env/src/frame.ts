import { dual } from "effect/Function";

import type frameTypes from "./frame.types.ts";
import type remoteErrorTypes from "./remote-error.types.ts";

const REQUEST = 1;
const RESULT = 2;
const ERROR = 3;
const EVENT = 4;
const CANCEL = 5;
const PING = 6;

const MAX_FRAME = 16 * 1024 * 1024;

function wellFormed(_key: string, value: unknown): unknown {
  return typeof value === "string" ? value.toWellFormed() : value;
}

function frame({ type, id, json, payload = new Uint8Array(0) }: frameTypes.Frame): Buffer {
  const body = Buffer.from(JSON.stringify(json, wellFormed), "utf8");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(9 + body.length + payload.length, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(id, 5);
  header.writeUInt32BE(body.length, 9);
  return Buffer.concat([header, body, payload]);
}

const parseFrameJson: {
  (length: number, jsonLength: number): (body: Buffer) => remoteErrorTypes.Json | undefined;
  (body: Buffer, length: number, jsonLength: number): remoteErrorTypes.Json | undefined;
} = dual(
  3,
  (body: Buffer, length: number, jsonLength: number): remoteErrorTypes.Json | undefined => {
    if (9 + jsonLength > length) return undefined;
    try {
      const parsed: unknown = JSON.parse(body.subarray(9, 9 + jsonLength).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      return parsed as remoteErrorTypes.Json;
    } catch {
      return undefined;
    }
  },
);

const frameModule = {
  CANCEL,
  ERROR,
  EVENT,
  MAX_FRAME,
  PING,
  REQUEST,
  RESULT,
  frame,
  parseFrameJson,
};

export default frameModule;
