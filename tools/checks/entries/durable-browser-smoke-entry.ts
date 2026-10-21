import durableModule from "@msa/durable";
import env from "@msa/durable/env";
import jsonlModule from "@msa/durable/storage/jsonl";
import sqliteModule from "@msa/durable/storage/sqlite";

const liveBindings = [
  Object.keys(durableModule),
  Object.keys(env),
  Object.keys(jsonlModule),
  Object.keys(sqliteModule),
];

export default liveBindings;
