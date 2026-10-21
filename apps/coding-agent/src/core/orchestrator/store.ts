import dbModule from "./db.ts";
import noteStoreModule from "./note-store.ts";
import stateStoreModule from "./state-store.ts";
import taskStoreModule from "./task-store.ts";
import threadStoreModule from "./thread-store.ts";

const { db } = dbModule;
const { taskStore } = taskStoreModule;
const { threadStore } = threadStoreModule;
const { noteStore } = noteStoreModule;
const { recovery, stateStore } = stateStoreModule;

const store = {
  ...db,
  ...taskStore,
  ...threadStore,
  ...noteStore,
  ...stateStore,
  ...recovery,
};

const storeModule = {
  store,
};

export default storeModule;
