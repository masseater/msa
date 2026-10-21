import ai from "@msa/ai";
import { Type } from "typebox";

const { StringEnum } = ai;

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  task: Type.String({ description: "Task to delegate to the agent" }),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  default: "user",
  description:
    'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
});

const SubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({ description: "Name of the agent to invoke (for single mode)" }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  chain: Type.Optional(
    Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" }),
  ),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      default: true,
      description: "Prompt before running project-local agents. Default: true.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process (single mode)" }),
  ),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
  tasks: Type.Optional(
    Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" }),
  ),
});

const subagentTypes = {
  COLLAPSED_ITEM_COUNT,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  PER_TASK_OUTPUT_CAP,
  SubagentParams,
};

export default subagentTypes;
