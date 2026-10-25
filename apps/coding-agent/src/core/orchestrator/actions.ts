import taskCreate from "./task-create.ts";
import taskEdit from "./task-edit.ts";
import taskMessages from "./task-messages.ts";
import taskNotes from "./task-notes.ts";
import taskRunControl from "./task-run-control.ts";

const actions = {
  ...taskCreate,
  ...taskEdit,
  ...taskMessages,
  ...taskNotes,
  ...taskRunControl,
};

const actionsModule = {
  actions,
};

export default actionsModule;
