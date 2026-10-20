import JsonlCorruptionError from "./corruption-error.ts";
import JsonlStoragePoisonedError from "./poisoned-error.ts";
import JsonlStorage from "./storage.ts";

const jsonl = {
  JsonlCorruptionError: JsonlCorruptionError,
  JsonlStorage: JsonlStorage,
  JsonlStoragePoisonedError: JsonlStoragePoisonedError,
};

export default jsonl;
