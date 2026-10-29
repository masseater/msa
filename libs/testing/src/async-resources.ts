import { createHook } from "node:async_hooks";

import type asyncResourcesTypes from "./async-resources.types.ts";
import timers from "./timers.ts";

const trackChildProcesses = (): asyncResourcesTypes.ChildProcessTracker => {
  const live = new Set<number>();
  createHook({
    destroy: (id) => {
      live.delete(id);
    },
    init: (id, type) => {
      if (type === "PROCESSWRAP") live.add(id);
    },
  }).enable();
  return { running: () => live.size > 0 };
};

const asyncResources = { timersArmedBy: timers.timersArmedBy, trackChildProcesses };

export default asyncResources;
