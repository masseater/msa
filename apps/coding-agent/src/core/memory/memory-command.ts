import type memoryTypes from "./memory.types.ts";

function parseMemoryCommand(text: string): memoryTypes.MemoryCommand | undefined {
  const match = /^\/memory(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return undefined;
  const request = (match[1] ?? "").trim();
  return request === "" ? { kind: "status" } : { kind: "request", request };
}

const memoryCommand = { parseMemoryCommand };

export default memoryCommand;
