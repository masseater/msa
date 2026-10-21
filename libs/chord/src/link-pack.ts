import { dual } from "effect/Function";

import type compressionTypes from "./compression.types.ts";
import Packed from "./packed.ts";
import type wireTypes from "./wire.types.ts";

type Compression = compressionTypes.Compression;

const PACK_THRESHOLD = 64 * 1024;

function unpack(value: unknown): unknown {
  if (!(value instanceof Packed)) return value;
  return JSON.parse(value.compression.inflateRaw(value.bytes));
}

type PayloadField = "args" | "value";
const PAYLOAD_FIELDS: ReadonlySet<string> = new Set<PayloadField>(["args", "value"]);

function payloadField(frame: wireTypes.Frame): PayloadField | undefined {
  if (frame.t === "call") return frame.args === undefined ? undefined : "args";
  if (frame.t === "result" || frame.t === "state")
    return frame.value === undefined ? undefined : "value";
  return undefined;
}

function envelopeOf(frame: wireTypes.Frame, field: PayloadField): Record<string, unknown> {
  const envelope: Record<string, unknown> = { ...frame };
  delete envelope[field];
  return envelope;
}

function packedBytes(
  value: unknown,
  compression: Compression | undefined,
  json?: string,
): Uint8Array | undefined {
  if (value instanceof Packed) return value.bytes;
  if (compression === undefined || json === undefined || json.length <= PACK_THRESHOLD)
    return undefined;
  return compression.deflateRaw(json);
}

function packObjectImpl(frame: wireTypes.Frame, compression: Compression | undefined): unknown {
  const field = payloadField(frame);
  if (field === undefined) return frame;
  const value = (frame as Record<string, unknown>)[field];
  const bytes = packedBytes(
    value,
    compression,
    compression === undefined ? undefined : JSON.stringify(value),
  );
  if (bytes === undefined) return frame;
  return {
    ...envelopeOf(frame, field),
    z: [field, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")],
  };
}

function unpackObjectImpl(message: unknown, compression: Compression | undefined): unknown {
  if (message === null || typeof message !== "object" || !("z" in message)) return message;
  const { z, ...rest } = message as { z: unknown } & Record<string, unknown>;
  if (!Array.isArray(z) || !PAYLOAD_FIELDS.has(z[0]) || typeof z[1] !== "string")
    throw new TypeError("bad packed payload");
  if (compression === undefined) throw new TypeError("packed payload without compression");
  return { ...rest, [z[0]]: new Packed(Buffer.from(z[1], "base64"), compression) };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function packMessageImpl(
  frame: wireTypes.Frame,
  compression: Compression | undefined,
): string | Uint8Array {
  const field = payloadField(frame);
  if (field === undefined) return JSON.stringify(frame);
  const value = (frame as Record<string, unknown>)[field];
  const json = value instanceof Packed ? undefined : JSON.stringify(value);
  const bytes = packedBytes(value, compression, json);
  const envelope = envelopeOf(frame, field);
  if (bytes === undefined) {
    const head = JSON.stringify(envelope);
    return `${head.slice(0, -1)},${JSON.stringify(field)}:${json}}`;
  }
  const head = encoder.encode(JSON.stringify({ ...envelope, z: field }));
  const message = new Uint8Array(4 + head.byteLength + bytes.byteLength);
  new DataView(message.buffer).setUint32(0, head.byteLength);
  message.set(head, 4);
  message.set(bytes, 4 + head.byteLength);
  return message;
}

const packObject: {
  (compression: Compression | undefined): (frame: wireTypes.Frame) => unknown;
  (frame: wireTypes.Frame, compression: Compression | undefined): unknown;
} = dual(2, packObjectImpl);

const unpackObject: {
  (compression: Compression | undefined): (message: unknown) => unknown;
  (message: unknown, compression: Compression | undefined): unknown;
} = dual(2, unpackObjectImpl);

const packMessage: {
  (compression: Compression | undefined): (frame: wireTypes.Frame) => string | Uint8Array;
  (frame: wireTypes.Frame, compression: Compression | undefined): string | Uint8Array;
} = dual(2, packMessageImpl);

function splitMessage(data: Uint8Array): {
  envelope: Record<string, unknown>;
  field: PayloadField;
  bytes: Uint8Array;
} {
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  const envelope = JSON.parse(decoder.decode(data.subarray(4, 4 + length))) as unknown;
  if (envelope === null || typeof envelope !== "object") throw new TypeError("bad envelope");
  const { z: field, ...rest } = envelope as { z?: unknown } & Record<string, unknown>;
  if (typeof field !== "string" || !PAYLOAD_FIELDS.has(field))
    throw new TypeError("bad packed payload");
  return { bytes: data.slice(4 + length), envelope: rest, field: field as PayloadField };
}

function inflateMessageImpl(data: Uint8Array, compression: Compression): string {
  const { envelope, field, bytes } = splitMessage(data);
  const head = JSON.stringify(envelope);
  return `${head.slice(0, -1)},${JSON.stringify(field)}:${compression.inflateRaw(bytes)}}`;
}

const inflateMessage: {
  (compression: Compression): (data: Uint8Array) => string;
  (data: Uint8Array, compression: Compression): string;
} = dual(2, inflateMessageImpl);

function inflate(bytes: Uint8Array): Promise<unknown> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text().then((text) => JSON.parse(text) as unknown);
}

function parseFrameImpl(data: string, compression: Compression | undefined): wireTypes.Frame {
  const frame = unpackObject(JSON.parse(data), compression) as wireTypes.Frame;
  if (frame === null || typeof frame !== "object" || typeof frame.t !== "string")
    throw new TypeError("not a frame");
  return frame;
}

const parseFrame: {
  (compression: Compression | undefined): (data: string) => wireTypes.Frame;
  (data: string, compression: Compression | undefined): wireTypes.Frame;
} = dual(2, parseFrameImpl);

const linkPack = {
  PACK_THRESHOLD,
  Packed,
  inflate,
  inflateMessage,
  packMessage,
  packObject,
  parseFrame,
  splitMessage,
  unpack,
  unpackObject,
};

export default linkPack;
