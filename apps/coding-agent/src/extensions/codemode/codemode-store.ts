import type sessionManagerTypes from "../../core/session-manager.types.ts";
import toolModule from "./tool.ts";
import type toolTypes from "./tool.types.ts";

const { CODEMODE_STORE_ENTRY_TYPE } = toolModule;

function isStoreEntryData(data: unknown): data is toolTypes.CodemodeStoreEntryData {
  if (typeof data !== "object" || data === null) return false;
  const { set, delete: deleted } = data as Partial<toolTypes.CodemodeStoreEntryData>;
  return (
    typeof set === "object" &&
    set !== null &&
    Array.isArray(deleted) &&
    deleted.every((key: unknown) => typeof key === "string")
  );
}

function readCodemodeStore(
  branch: readonly sessionManagerTypes.SessionEntry[],
): Record<string, unknown> {
  const store = new Map<string, unknown>();
  for (const entry of branch) {
    if (
      entry.type !== "custom" ||
      entry.customType !== CODEMODE_STORE_ENTRY_TYPE ||
      !isStoreEntryData(entry.data)
    ) {
      continue;
    }
    for (const key of entry.data.delete) store.delete(key);
    for (const [key, value] of Object.entries(entry.data.set)) store.set(key, value);
  }
  return Object.fromEntries(store);
}

const codemodeStore = { readCodemodeStore };

export default codemodeStore;
