import loader from "./loader.ts";
import managerChild from "./manager-child.ts";
import managerFork from "./manager-fork.ts";
import managerLock from "./manager-lock.ts";
import manager from "./manager.ts";

const node = {
  childControl: managerChild.childControl,
  createHostManager: manager.createHostManager,
  forkDriver: managerFork.forkDriver,
  nodeLoader: loader.nodeLoader,
  parentChannel: managerChild.parentChannel,
  processLock: managerLock.processLock,
};

export default node;
