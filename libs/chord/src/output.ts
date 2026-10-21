import { dual } from "effect/Function";

import type outputTypes from "./output.types.ts";

const NEWLINE = 0x0a;
const INVALID_OUTPUT = /(?![\t\n\u007f-\u009f])\p{Cc}|[\ufff9-\ufffb]/gu;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

function sanitizeOutput(text: string): string {
  return text.replace(INVALID_OUTPUT, "");
}

function outputBounded(text: string, limits: outputTypes.OutputLimits): outputTypes.OutputSlice {
  const bytes = encoder.encode(text);
  const [from, to] = limits.retain === "head" ? headRange(bytes, limits) : tailRange(bytes, limits);
  const kept = bytes.subarray(from, to);
  return {
    bytes: kept.length,
    droppedBytes: bytes.length - kept.length,
    droppedLines: lineCount(bytes) - lineCount(kept),
    text: kept.length === bytes.length ? text : decoder.decode(kept),
  };
}

function headRange(bytes: Uint8Array, limits: outputTypes.OutputLimits): [number, number] {
  if (limits.maxLines === 0 || limits.maxBytes === 0) return [0, 0];
  let end = bytes.length;
  let newlines = 0;
  for (
    let index = bytes.indexOf(NEWLINE);
    index !== -1;
    index = bytes.indexOf(NEWLINE, index + 1)
  ) {
    if (++newlines === limits.maxLines) {
      end = index + 1;
      break;
    }
  }
  if (end > limits.maxBytes) {
    const newline = bytes.lastIndexOf(NEWLINE, limits.maxBytes - 1);
    end = newline === -1 ? characterEnd(bytes, limits.maxBytes) : newline + 1;
  }
  return [0, end];
}

function tailRange(bytes: Uint8Array, limits: outputTypes.OutputLimits): [number, number] {
  if (limits.maxLines === 0 || limits.maxBytes === 0) return [bytes.length, bytes.length];
  const last = bytes[bytes.length - 1] === NEWLINE ? bytes.length - 2 : bytes.length - 1;
  let start = 0;
  let newlines = 1;
  for (let index = last < 0 ? -1 : bytes.lastIndexOf(NEWLINE, last); index !== -1;) {
    if (newlines === limits.maxLines) {
      start = index + 1;
      break;
    }
    newlines++;
    index = index === 0 ? -1 : bytes.lastIndexOf(NEWLINE, index - 1);
  }
  if (bytes.length - start > limits.maxBytes) {
    const from = bytes.length - limits.maxBytes;
    const newline = bytes.indexOf(NEWLINE, from - 1);
    start =
      newline !== -1 && newline + 1 < bytes.length ? newline + 1 : characterStart(bytes, from);
  }
  return [start, bytes.length];
}

function endOfCharacter(bytes: Uint8Array, index: number): number {
  let end = index;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return end;
}

function characterStart(bytes: Uint8Array, index: number): number {
  let start = index;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return start;
}

function lineCount(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let newlines = 0;
  for (let index = bytes.indexOf(NEWLINE); index !== -1; index = bytes.indexOf(NEWLINE, index + 1))
    newlines++;
  return newlines + (bytes[bytes.length - 1] === NEWLINE ? 0 : 1);
}

interface RuntimeBuffer {
  byteLength(content: string, encoding: "utf8"): number;
}

const runtimeBuffer = (globalThis as { Buffer?: RuntimeBuffer }).Buffer;
const nonAsciiPattern = /\P{ASCII}/u;

function utf8ByteLength(content: string): number {
  if (runtimeBuffer !== undefined) return runtimeBuffer.byteLength(content, "utf8");
  const firstNonAscii = content.search(nonAsciiPattern);
  if (firstNonAscii === -1) return content.length;
  let bytes = firstNonAscii;
  for (let i = firstNonAscii; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

const boundOutput: {
  (limits: outputTypes.OutputLimits): (text: string) => outputTypes.OutputSlice;
  (text: string, limits: outputTypes.OutputLimits): outputTypes.OutputSlice;
} = dual(2, outputBounded);

const characterEnd: {
  (index: number): (bytes: Uint8Array) => number;
  (bytes: Uint8Array, index: number): number;
} = dual(2, endOfCharacter);

function tailMargin(text: string, limits: outputTypes.OutputLimits): string {
  const bytes = encoder.encode(text);
  const byteStart =
    bytes.length > limits.maxBytes ? characterEnd(bytes, bytes.length - limits.maxBytes - 1) : 0;
  let lineStart = 0;
  let newlines = 0;
  for (
    let index = bytes.lastIndexOf(NEWLINE);
    index !== -1;
    index = bytes.lastIndexOf(NEWLINE, index - 1)
  ) {
    if (++newlines > limits.maxLines) {
      lineStart = index;
      break;
    }
    if (index === 0) break;
  }
  const start = Math.max(byteStart, lineStart);
  return start === 0 ? text : decoder.decode(bytes.subarray(start));
}

function lines(newlines: number, terminated: boolean): number {
  return newlines + (terminated ? 0 : 1);
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
  return count;
}

class OutputBuffer {
  readonly #limits: outputTypes.OutputLimits;
  readonly #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  #started = false;
  #chunks: { readonly text: string; readonly bytes: number; readonly newlines: number }[] = [];
  #storedBytes = 0;
  #storedNewlines = 0;
  #full = false;
  #totalBytes = 0;
  #totalNewlines = 0;
  #endsWithNewline = true;

  constructor(limits: outputTypes.OutputLimits) {
    this.#limits = limits;
  }

  get storedBytes(): number {
    return this.#storedBytes;
  }

  push(chunk: string | Uint8Array, skipped?: outputTypes.OutputSkip): boolean {
    const pending =
      typeof chunk === "string" || skipped !== undefined ? this.#decoder.decode() : "";
    let text = typeof chunk === "string" ? chunk : this.#decoder.decode(chunk, { stream: true });
    const first = !this.#started && pending === "" && skipped === undefined;
    if (pending !== "" || text !== "" || skipped !== undefined) this.#started = true;
    if (first && typeof chunk !== "string" && text.startsWith("\ufeff")) text = text.slice(1);
    if (skipped === undefined) return this.#accept(pending + text);
    if (this.#limits.retain !== "tail") throw new Error("Skipped output requires tail retention");
    this.#accept(pending);
    this.#skip(skipped);
    this.#accept(text);
    return true;
  }

  #skip(skipped: outputTypes.OutputSkip): void {
    if (skipped.bytes === 0) return;
    this.#totalBytes += skipped.bytes;
    this.#totalNewlines += skipped.newlines;
    this.#endsWithNewline = skipped.endsWithNewline;
    this.#chunks = [];
    this.#storedBytes = 0;
    this.#storedNewlines = 0;
  }

  end(): void {
    this.#accept(this.#decoder.decode());
  }

  #accept(text: string): boolean {
    if (text.length === 0) return false;
    const bytes = utf8ByteLength(text);
    const newlines = countNewlines(text);
    this.#totalBytes += bytes;
    this.#totalNewlines += newlines;
    this.#endsWithNewline = text.endsWith("\n");
    if (this.#full) return true;
    this.#chunks.push({ bytes, newlines, text });
    this.#storedBytes += bytes;
    this.#storedNewlines += newlines;
    if (this.#limits.retain === "head") {
      this.#full =
        this.#storedBytes > this.#limits.maxBytes || this.#storedNewlines >= this.#limits.maxLines;
      return true;
    }
    while (this.#chunks.length > 1) {
      const first = this.#chunks[0]!;
      const bytesAfter = this.#storedBytes - first.bytes;
      const newlinesAfter = this.#storedNewlines - first.newlines;
      if (bytesAfter <= this.#limits.maxBytes + 1 && newlinesAfter <= this.#limits.maxLines + 1)
        break;
      this.#chunks.shift();
      this.#storedBytes = bytesAfter;
      this.#storedNewlines = newlinesAfter;
    }
    return true;
  }

  snapshot(): outputTypes.BoundedOutput {
    const stored =
      this.#chunks.length === 1
        ? this.#chunks[0]!.text
        : this.#chunks.map((chunk) => chunk.text).join("");
    const kept = boundOutput(stored, this.#limits);
    const storedLines = lines(this.#storedNewlines, stored === "" || stored.endsWith("\n"));
    const keptLines = storedLines - kept.droppedLines;
    if (this.#limits.retain === "tail" || this.#chunks.length > 1) {
      const text = this.#limits.retain === "tail" ? tailMargin(stored, this.#limits) : stored;
      const bytes = this.#limits.retain === "tail" ? utf8ByteLength(text) : this.#storedBytes;
      this.#chunks = text === "" ? [] : [{ bytes, newlines: countNewlines(text), text }];
      this.#storedBytes = bytes;
      this.#storedNewlines = this.#chunks[0]?.newlines ?? 0;
    }
    return {
      droppedBytes: this.#totalBytes - kept.bytes,
      droppedLines: lines(this.#totalNewlines, this.#endsWithNewline) - keptLines,
      text: sanitizeOutput(kept.text),
    };
  }
}

const output = {
  NEWLINE,
  OutputBuffer,
  boundOutput,
  characterEnd,
  decoder,
  encoder,
  sanitizeOutput,
  utf8ByteLength,
};

export default output;
