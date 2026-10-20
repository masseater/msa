import MemoryLink from "./memory-link.ts";

function memoryLinkPair(): [MemoryLink, MemoryLink] {
  const a = new MemoryLink();
  const b = new MemoryLink();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const linkMemory = {
  MemoryLink,
  memoryLinkPair,
};

export default linkMemory;
