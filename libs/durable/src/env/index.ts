import decodeModule from "./decode.ts";
import ExecutionError from "./execution-error.ts";
import FileError from "./file-error.ts";
import LineScanner from "./line-scan.ts";
import resultModule from "./result.ts";
import StreamDecoder from "./stream-decoder.ts";

const env = {
  ExecutionError: ExecutionError,
  FileError: FileError,
  LineScanner: LineScanner,
  StreamDecoder: StreamDecoder,
  err: resultModule.err,
  getOrThrow: resultModule.getOrThrow,
  getOrUndefined: resultModule.getOrUndefined,
  ok: resultModule.ok,
  rangeDecoder: decodeModule.rangeDecoder,
  startsWithBom: decodeModule.startsWithBom,
  toError: resultModule.toError,
};

export default env;
