import documents from "./documents.ts";
import entries from "./entries.ts";
import errors from "./errors.ts";
import define from "./harness/define.ts";
import harnessDocs from "./harness/docs.ts";
import tasks from "./tasks.ts";
import ids from "./types/ids.ts";

const durable = {
  ConversationBusy: errors.ConversationBusy,
  ReadAfterWrite: errors.ReadAfterWrite,
  SessionFailed: errors.SessionFailed,
  StorageRequestError: errors.StorageRequestError,
  ...harnessDocs,
  AssistantEntry: entries.AssistantEntry,
  CompactionEntry: entries.CompactionEntry,
  ROOT_CONVERSATION_ID: ids.ROOT_CONVERSATION_ID,
  ResetEntry: entries.ResetEntry,
  SystemEntry: entries.SystemEntry,
  ToolResultEntry: entries.ToolResultEntry,
  UserEntry: entries.UserEntry,
  defineDoc: documents.defineDoc,
  defineDocFamily: documents.defineDocFamily,
  defineEntry: entries.defineEntry,
  defineExtension: define.defineExtension,
  defineTask: tasks.defineTask,
  defineTool: define.defineTool,
  hook: define.hook,
  section: define.section,
  wrapSection: define.wrapSection,
  wrapTool: define.wrapTool,
};

export default durable;
