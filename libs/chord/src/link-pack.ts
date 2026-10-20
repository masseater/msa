import type * as Zlib from "node:zlib";

import { dual } from "effect/Function";

import Packed from "./packed.ts";
import type wireTypes from "./wire.types.ts";

const PACK_THRESHOLD = 64 * 1024;

const zlib: typeof Zlib | undefined = (
  globalThis as { process?: { getBuiltinModule?(id: "node:zlib"): typeof Zlib } }
).process?.getBuiltinModule?.("node:zlib");

const zlibAvailable = zlib !== undefined;

function unpack(value: unknown): unknown {
  if (!(value instanceof Packed)) return value;
  if (zlib === undefined) throw new TypeError("packed payload without zlib");
  return JSON.parse(zlib.inflateRawSync(value.bytes).toString("utf8"));
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

function packedBytes(value: unknown, compress: boolean, json?: string): Uint8Array | undefined {
  if (value instanceof Packed) return value.bytes;
  if (!compress || zlib === undefined || json === undefined || json.length <= PACK_THRESHOLD)
    return undefined;
  return zlib.deflateRawSync(json, { level: 1 });
}

function packObjectImpl(frame: wireTypes.Frame, compress: boolean): unknown {
  const field = payloadField(frame);
  if (field === undefined) return frame;
  const value = (frame as Record<string, unknown>)[field];
  const bytes = packedBytes(
    value,
    compress,
    compress && zlib !== undefined ? JSON.stringify(value) : undefined,
  );
  if (bytes === undefined) return frame;
  return {
    ...envelopeOf(frame, field),
    z: [field, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")],
  };
}

function unpackObject(message: unknown): unknown {
  if (message === null || typeof message !== "object" || !("z" in message)) return message;
  const { z, ...rest } = message as { z: unknown } & Record<string, unknown>;
  if (!Array.isArray(z) || !PAYLOAD_FIELDS.has(z[0]) || typeof z[1] !== "string")
    throw new TypeError("bad packed payload");
  return { ...rest, [z[0]]: new Packed(Buffer.from(z[1], "base64")) };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function packMessageImpl(frame: wireTypes.Frame, compress: boolean): string | Uint8Array {
  const field = payloadField(frame);
  if (field === undefined) return JSON.stringify(frame);
  const value = (frame as Record<string, unknown>)[field];
  const json = value instanceof Packed ? undefined : JSON.stringify(value);
  const bytes = packedBytes(value, compress, json);
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
  (compress: boolean): (frame: wireTypes.Frame) => unknown;
  (frame: wireTypes.Frame, compress: boolean): unknown;
} = dual(2, packObjectImpl);

const packMessage: {
  (compress: boolean): (frame: wireTypes.Frame) => string | Uint8Array;
  (frame: wireTypes.Frame, compress: boolean): string | Uint8Array;
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

function inflateMessage(data: Uint8Array): string {
  if (zlib === undefined) throw new TypeError("inflateMessage needs zlib");
  const { envelope, field, bytes } = splitMessage(data);
  const head = JSON.stringify(envelope);
  return `${head.slice(0, -1)},${JSON.stringify(field)}:${zlib.inflateRawSync(bytes).toString("utf8")}}`;
}

function inflate(bytes: Uint8Array): Promise<unknown> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text().then((text) => JSON.parse(text) as unknown);
}

function parseFrame(data: string): wireTypes.Frame {
  const frame = unpackObject(JSON.parse(data)) as wireTypes.Frame;
  if (frame === null || typeof frame !== "object" || typeof frame.t !== "string")
    throw new TypeError("not a frame");
  return frame;
}

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
  zlibAvailable,
};

export default linkPack;
