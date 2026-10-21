import taskCreate from "./task-create.ts";
import taskEdit from "./task-edit.ts";
import taskNotes from "./task-notes.ts";
import taskRunControl from "./task-run-control.ts";

const actions = {
  ...taskCreate,
  ...taskEdit,
  ...taskNotes,
  ...taskRunControl,
};

const actionsModule = {
  actions,
};

export default actionsModule;
