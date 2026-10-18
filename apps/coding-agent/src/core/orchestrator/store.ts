import { db } from "./db.ts";
import { noteStore } from "./note-store.ts";
import { sessionStore } from "./session-store.ts";
import { recovery, stateStore } from "./state-store.ts";
import { taskStore } from "./task-store.ts";

export const store = { ...db, ...taskStore, ...sessionStore, ...noteStore, ...stateStore, ...recovery };
