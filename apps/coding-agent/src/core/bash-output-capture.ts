import ansi from "../utils/ansi.ts";
import outputFiles from "../utils/output-files.ts";
import shell from "../utils/shell.ts";
import awaitingModule from "./awaiting.ts";
import type nodeFsTypes from "./platform/node/fs.types.ts";
import nodeStreamPromises from "./platform/node/stream-promises.ts";
import truncate from "./tools/truncate.ts";

const { finished } = nodeStreamPromises;
const { awaited } = awaitingModule;
const { DEFAULT_MAX_BYTES, truncateTail } = truncate;
const { createOutputFileStream } = outputFiles;
const { sanitizeBinaryOutput } = shell;
const { splitIncompleteAnsiSuffix, stripAnsi } = ansi;

const MAX_OUTPUT_BYTES = DEFAULT_MAX_BYTES * 2;

export default class BashOutputCapture {
  private readonly onChunk: ((chunk: string) => void) | undefined;
  private readonly outputChunks: string[] = [];
  private readonly decoder = new TextDecoder();
  private outputBytes = 0;
  private totalBytes = 0;
  private pendingAnsi = "";
  private tempFilePath: string | undefined;
  private tempFileStream: nodeFsTypes.WriteStream | undefined;

  constructor(onChunk: ((chunk: string) => void) | undefined) {
    this.onChunk = onChunk;
  }

  readonly write = (data: Buffer): void => {
    this.totalBytes += data.length;
    const { complete, pending } = splitIncompleteAnsiSuffix(
      this.pendingAnsi + this.decoder.decode(data, { stream: true }),
    );
    this.pendingAnsi = pending;
    this.appendText(complete);
  };

  discard(): void {
    this.tempFileStream?.end();
  }

  *finish() {
    const rest = this.pendingAnsi + this.decoder.decode();
    this.pendingAnsi = "";
    this.appendText(rest);
    const fullOutput = this.outputChunks.join("");
    const truncation = truncateTail(fullOutput);
    if (truncation.truncated) this.ensureTempFile();
    if (this.tempFileStream !== undefined) {
      yield* awaited(finished(this.tempFileStream.end()));
    }
    return {
      fullOutputPath: this.tempFilePath,
      output: truncation.truncated ? truncation.content : fullOutput,
      truncated: truncation.truncated,
    };
  }

  private ensureTempFile(): void {
    if (this.tempFilePath !== undefined && this.tempFilePath !== "") return;
    const { path, stream } = createOutputFileStream("msa-bash", ".log");
    this.tempFilePath = path;
    this.tempFileStream = stream;
    for (const chunk of this.outputChunks) stream.write(chunk);
  }

  private appendText(rawText: string): void {
    const text = sanitizeBinaryOutput(stripAnsi(rawText)).replace(/\r/gu, "");
    if (text === "") return;
    if (this.totalBytes > DEFAULT_MAX_BYTES) this.ensureTempFile();
    this.tempFileStream?.write(text);
    this.outputChunks.push(text);
    this.outputBytes += text.length;
    while (this.outputBytes > MAX_OUTPUT_BYTES && this.outputChunks.length > 1) {
      this.outputBytes -= this.outputChunks.shift()!.length;
    }
    this.onChunk?.(text);
  }
}
