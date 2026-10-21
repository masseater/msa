import compaction from "./compaction.ts";
import eventsModule from "./events.ts";
import generation from "./generation.ts";
import harnessModule from "./harness.ts";
import registry from "./registry.ts";
import tool from "./tool.ts";

const harness = {
  CompactionTask: compaction.CompactionTask,
  GenerationTask: generation.GenerationTask,
  Harness: harnessModule.Harness,
  ToolTask: tool.ToolTask,
  createRegistry: registry.createRegistry,
  watchEvents: eventsModule.watchEvents,
};

export default harness;
