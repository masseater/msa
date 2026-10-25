import taskCreate from "./task-create.ts";
import taskEdit from "./task-edit.ts";
import taskMessage from "./task-message.ts";
import taskNotes from "./task-notes.ts";
import taskRunControl from "./task-run-control.ts";

const actions = {
  ...taskCreate,
  ...taskEdit,
  ...taskMessage,
  ...taskNotes,
  ...taskRunControl,
};

const actionsModule = {
  actions,
};

export default actionsModule;
