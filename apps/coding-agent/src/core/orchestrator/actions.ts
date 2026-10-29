import pullRequestDirect from "./pull-request-direct.ts";
import taskCreate from "./task-create.ts";
import taskEdit from "./task-edit.ts";
import taskMessages from "./task-messages.ts";
import taskNotes from "./task-notes.ts";
import taskRunControl from "./task-run-control.ts";
import taskStateEdit from "./task-state-edit.ts";

const actions = {
  ...pullRequestDirect,
  ...taskCreate,
  ...taskEdit,
  ...taskMessages,
  ...taskNotes,
  ...taskRunControl,
  ...taskStateEdit,
};

const actionsModule = {
  actions,
};

export default actionsModule;
