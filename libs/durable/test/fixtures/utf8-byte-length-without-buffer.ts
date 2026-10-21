import truncate from "../../src/truncate.ts";

const { truncateHead, utf8ByteLength } = truncate;

const inputs: string[] = JSON.parse(process.argv[2] ?? "[]");

process.stdout.write(
  JSON.stringify({
    bufferAvailable: "Buffer" in globalThis,
    head: truncateHead("aé🙂\nb", { maxBytes: 7, maxLines: 10 }),
    lengths: inputs.map((input) => utf8ByteLength(input)),
  }),
);
