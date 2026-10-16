import * as durable from "@msa/durable";
import * as environment from "@msa/durable/env";
import * as jsonl from "@msa/durable/storage/jsonl";
import * as sqlite from "@msa/durable/storage/sqlite";

// Keep runtime-neutral public entry points live so the browser smoke build
// catches accidental imports of Node-only adapters or built-ins.
console.log(
  Object.keys(durable),
  Object.keys(environment),
  Object.keys(jsonl),
  Object.keys(sqlite),
);
