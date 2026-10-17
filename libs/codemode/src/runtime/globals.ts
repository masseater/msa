import type { CodemodeDeclaredGlobal } from "../types.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const RESERVED_GLOBALS: ReadonlySet<string> = new Set([
  "tools",
  "ALL_TOOLS",
  "console",
  "text",
  "image",
  "exit",
  "globalThis",
  "store",
  "load",
]);

export function checkGlobals(globals: readonly CodemodeDeclaredGlobal[]): void {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const global of globals) {
    const parts = global.name.split(".");
    const [root] = parts;
    if (
      root === undefined ||
      parts.length > 2 ||
      !parts.every((part) => IDENTIFIER.test(part)) ||
      RESERVED_GLOBALS.has(root)
    ) {
      throw new Error(`Invalid global name "${global.name}"`);
    }
    if (names.has(global.name)) throw new Error(`Global "${global.name}" is already registered`);
    if (parts.length === 2) namespaces.add(root);
    names.add(global.name);
  }
  for (const name of namespaces) {
    if (names.has(name)) throw new Error(`Global "${name}" conflicts with the namespace "${name}"`);
  }
}
