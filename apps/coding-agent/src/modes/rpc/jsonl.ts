import { StringDecoder } from "node:string_decoder";

import { dual } from "effect/Function";

import type nodeStreamTypes from "../../core/platform/node/stream.types.ts";

function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const attachJsonlLineReader: {
  (onLine: (line: string) => void): (stream: nodeStreamTypes.Readable) => () => void;
  (stream: nodeStreamTypes.Readable, onLine: (line: string) => void): () => void;
} = dual(2, (stream: nodeStreamTypes.Readable, onLine: (line: string) => void): (() => void) => {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emitLine = (line: string) => {
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  const onData = (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      emitLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };

  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      emitLine(buffer);
      buffer = "";
    }
  };

  stream.on("data", onData);
  stream.on("end", onEnd);

  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
});

const jsonl = {
  attachJsonlLineReader,
  serializeJsonLine,
};

export default jsonl;
