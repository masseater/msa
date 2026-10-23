import taskDependencies from "./task-dependencies.ts";
import taskMerges from "./task-merges.ts";
import taskRounds from "./task-rounds.ts";
import taskRows from "./task-rows.ts";

const { workTasksOfRound, reviewTaskOfRound, listRoundIds, insertRound } = taskRounds;
const { updateTask, setTaskStatus, listTasks, insertTask, getTask, deleteTask } = taskRows;
const {
  unfinishedDependencies,
  tasksWithCondition,
  replaceDependencies,
  removeDependency,
  readyTasks,
  listDependencyPairs,
  dependentsOf,
  dependenciesOf,
  clearDependencies,
  addDependency,
} = taskDependencies;

const taskStore = {
  ...taskMerges,
  addDependency,
  clearDependencies,
  deleteTask,
  dependenciesOf,
  dependentsOf,
  getTask,
  insertRound,
  insertTask,
  listDependencyPairs,
  listRoundIds,
  listTasks,
  readyTasks,
  removeDependency,
  replaceDependencies,
  reviewTaskOfRound,
  setTaskStatus,
  tasksWithCondition,
  unfinishedDependencies,
  updateTask,
  workTasksOfRound,
};

const taskStoreModule = { taskStore };

export default taskStoreModule;
