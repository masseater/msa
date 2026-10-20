import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import outputFiles from "../../utils/output-files.ts";
import type outputFilesTypes from "../../utils/output-files.types.ts";
import platform from "../platform/index.ts";
import type outputAccumulatorTypes from "./output-accumulator.types.ts";
import truncate from "./truncate.ts";
import type truncateTypes from "./truncate.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { createOutputFileStream } = outputFiles;
const { rethrowCause } = platform;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } = truncate;

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

type OutputFileStream = outputFilesTypes.OutputFileStream["stream"];

const readOutputFile = (path: string, maxBytes: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(path, { flag: "r" });
      const size = Number((yield* file.stat).size);
      if (size <= maxBytes) {
        return { content: new TextDecoder().decode(yield* fs.readFile(path)), truncated: false };
      }
      const headBytes = Math.floor(maxBytes / 2);
      const tailBytes = maxBytes - headBytes;
      const head = Buffer.alloc(headBytes);
      const tail = Buffer.alloc(tailBytes);
      yield* file.read(head);
      yield* file.seek(BigInt(size - tailBytes), "start");
      yield* file.read(tail);
      const headText = new TextDecoder().decode(head, { stream: true });
      let tailStart = 0;
      while (tailStart < tail.length && ((tail[tailStart] ?? 0) & 0xc0) === 0x80) tailStart++;
      const tailText = new TextDecoder().decode(tail.subarray(tailStart));
      const omitted = size - headBytes - tailBytes;
      return {
        content: `${headText}\n\n[... ${omitted} bytes omitted ...]\n\n${tailText}`,
        truncated: true,
      };
    }),
  ).pipe(rethrowCause);

const endStream = (stream: OutputFileStream) =>
  Effect.callback<void>((resume) => {
    const onError = (error: Error): void => {
      stream.off("finish", onFinish);
      resume(Effect.die(error));
    };
    const onFinish = (): void => {
      stream.off("error", onError);
      resume(Effect.void);
    };
    stream.once("error", onError);
    stream.once("finish", onFinish);
    stream.end();
  });

export default class OutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxRollingBytes: number;
  private readonly tempFilePrefix: string;
  private readonly decoder = new TextDecoder();

  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private completedLines = 0;
  private totalLines = 0;
  private currentLineBytes = 0;
  private hasOpenLine = false;
  private finished = false;

  private tempFilePath: string | undefined;
  private tempFileStream: OutputFileStream | undefined;

  constructor(options: outputAccumulatorTypes.OutputAccumulatorOptions = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
    this.tempFilePrefix = options.tempFilePrefix ?? "msa-output";
  }

  append(data: Buffer): void {
    if (this.finished) {
      throw new Error("Cannot append to a finished output accumulator");
    }

    this.totalRawBytes += data.length;
    this.appendDecodedText(this.decoder.decode(data, { stream: true }));

    if (this.tempFileStream !== undefined || this.shouldUseTempFile()) {
      this.ensureTempFile();
      this.tempFileStream?.write(data);
    } else if (data.length > 0) {
      this.rawChunks.push(data);
    }
  }

  finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.appendDecodedText(this.decoder.decode());
    if (this.shouldUseTempFile()) {
      this.ensureTempFile();
    }
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): outputAccumulatorTypes.OutputSnapshot {
    const tailTruncation = truncateTail(this.getSnapshotText(), {
      maxBytes: this.maxBytes,
      maxLines: this.maxLines,
    });
    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes;
    const truncatedBy = truncated
      ? (tailTruncation.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? "bytes" : "lines"))
      : null;
    const truncation: truncateTypes.TruncationResult = {
      ...tailTruncation,
      maxBytes: this.maxBytes,
      maxLines: this.maxLines,
      totalBytes: this.totalDecodedBytes,
      totalLines: this.totalLines,
      truncated,
      truncatedBy,
    };

    if (options.persistIfTruncated === true && truncation.truncated) {
      this.ensureTempFile();
    }

    return {
      content: truncation.content,
      fullOutputPath: this.tempFilePath,
      truncation,
    };
  }

  closeTempFile(): Promise<void> {
    const stream = this.tempFileStream;
    if (stream === undefined) {
      return Promise.resolve();
    }
    this.tempFileStream = undefined;
    return nodeRuntime.runPromise(endStream(stream));
  }

  readFullOutput(maxBytes: number): Promise<outputAccumulatorTypes.FullOutput> {
    if (this.tempFilePath === undefined || this.tempFilePath === "") {
      return Promise.resolve({
        content: new TextDecoder().decode(Buffer.concat(this.rawChunks)),
        truncated: false,
      });
    }
    return nodeRuntime.runPromise(readOutputFile(this.tempFilePath, maxBytes));
  }

  getLastLineBytes(): number {
    return this.currentLineBytes;
  }

  private appendDecodedText(text: string): void {
    if (text.length === 0) {
      return;
    }

    const bytes = byteLength(text);
    this.totalDecodedBytes += bytes;
    this.tailText += text;
    this.tailBytes += bytes;
    if (this.tailBytes > this.maxRollingBytes * 2) {
      this.trimTail();
    }

    let newlines = 0;
    let lastNewline = -1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
      newlines++;
      lastNewline = i;
    }
    if (newlines === 0) {
      this.currentLineBytes += bytes;
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      const tail = text.slice(lastNewline + 1);
      this.currentLineBytes = byteLength(tail);
      this.hasOpenLine = tail.length > 0;
    }
    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, "utf-8");
    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;
      return;
    }

    let start = buffer.length - this.maxRollingBytes;
    while (start < buffer.length && ((buffer[start] ?? 0) & 0xc0) === 0x80) {
      start++;
    }

    this.tailStartsAtLineBoundary =
      start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString("utf-8");
    this.tailBytes = byteLength(this.tailText);
  }

  private getSnapshotText(): string {
    if (this.tailStartsAtLineBoundary) {
      return this.tailText;
    }

    const firstNewline = this.tailText.indexOf("\n");
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  private shouldUseTempFile(): boolean {
    return (
      this.totalRawBytes > this.maxBytes ||
      this.totalDecodedBytes > this.maxBytes ||
      this.totalLines > this.maxLines
    );
  }

  private ensureTempFile(): void {
    if (this.tempFilePath !== undefined && this.tempFilePath !== "") {
      return;
    }
    const { path, stream } = createOutputFileStream(this.tempFilePrefix, ".log");
    this.tempFilePath = path;
    this.tempFileStream = stream;
    for (const chunk of this.rawChunks) {
      this.tempFileStream.write(chunk);
    }
    this.rawChunks = [];
  }
}
