import { dual } from "effect/Function";

import type { Json } from "./remote-error.ts";

export const REQUEST = 1;
export const RESULT = 2;
export const ERROR = 3;
export const EVENT = 4;
export const CANCEL = 5;
export const PING = 6;

export const MAX_FRAME = 16 * 1024 * 1024;

function wellFormed(_key: string, value: unknown): unknown {
  return typeof value === "string" ? value.toWellFormed() : value;
}

export interface Frame {
  readonly type: number;
  readonly id: number;
  readonly json: Json;
  readonly payload?: Uint8Array | undefined;
}

export function frame({ type, id, json, payload = new Uint8Array(0) }: Frame): Buffer {
  const body = Buffer.from(JSON.stringify(json, wellFormed), "utf8");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(9 + body.length + payload.length, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(id, 5);
  header.writeUInt32BE(body.length, 9);
  return Buffer.concat([header, body, payload]);
}

export const parseFrameJson: {
  (length: number, jsonLength: number): (body: Buffer) => Json | undefined;
  (body: Buffer, length: number, jsonLength: number): Json | undefined;
} = dual(3, (body: Buffer, length: number, jsonLength: number): Json | undefined => {
  if (9 + jsonLength > length) return undefined;
  try {
    const parsed: unknown = JSON.parse(body.subarray(9, 9 + jsonLength).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Json;
  } catch {
    return undefined;
  }
});
