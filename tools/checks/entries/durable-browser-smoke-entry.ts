import * as durable from "@msa/durable";
import * as environment from "@msa/durable/env";
import * as jsonl from "@msa/durable/storage/jsonl";
import * as sqlite from "@msa/durable/storage/sqlite";

export const liveBindings = [
  Object.keys(durable),
  Object.keys(environment),
  Object.keys(jsonl),
  Object.keys(sqlite),
];
