import dbModule from "./db.ts";
import noteStoreModule from "./note-store.ts";
import pullRequestStore from "./pull-request-store.ts";
import reportStoreModule from "./report-store.ts";
import stateStoreModule from "./state-store.ts";
import taskStoreModule from "./task-store.ts";
import threadStoreModule from "./thread-store.ts";
import watchdogStore from "./watchdog-store.ts";

const { db } = dbModule;
const { taskStore } = taskStoreModule;
const { threadStore } = threadStoreModule;
const { reportStore } = reportStoreModule;
const { noteStore } = noteStoreModule;
const { stateStore } = stateStoreModule;

const store = {
  ...db,
  ...taskStore,
  ...threadStore,
  ...reportStore,
  ...noteStore,
  ...stateStore,
  ...watchdogStore,
  ...pullRequestStore,
};

const storeModule = {
  store,
};

export default storeModule;
