import { createRequire } from "node:module";

const load = createRequire(import.meta.url);

function isSea(): boolean {
  if (process.versions["bun"] !== undefined) return false;
  return (load("node:sea") as { isSea(): boolean }).isSea();
}

const nodeSea = { isSea };

export default nodeSea;
