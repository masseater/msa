import type compressionTypes from "./compression.types.ts";
import MemoryLink from "./memory-link.ts";

function memoryLinkPair(options?: compressionTypes.CompressionOptions): [MemoryLink, MemoryLink] {
  const a = new MemoryLink(options);
  const b = new MemoryLink(options);
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const linkMemory = {
  MemoryLink,
  memoryLinkPair,
};

export default linkMemory;
