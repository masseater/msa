import { Effect } from "effect";

import advisorWorkspace from "./advisor-workspace.ts";
import decisionPrompts from "./decision-prompts.ts";
import promptsModule from "./prompts.ts";
import type runtimeTypes from "./runtime.types.ts";
import triageContext from "./triage-context.ts";
import triagePrompts from "./triage-prompts.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { worktrees } = worktreeModule;
const { prompts } = promptsModule;

function prepare(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  threadId: string,
): Effect.Effect<orchestratorTypesTypes.Workspace, runtimeTypes.WorkspaceError> {
  if (role === "worker" || role === "reviewer") return worktrees.prepare(runtime, task);
  const checkout = advisorWorkspace.prepare(runtime, task, threadId);
  if (role === "advisor") return checkout;
  return Effect.gen(function* () {
    const workspace = yield* checkout;
    return { ...workspace, history: yield* triageContext.history(runtime, task, workspace) };
  });
}

function block(
  role: orchestratorTypesTypes.ThreadRole,
  workspace: orchestratorTypesTypes.Workspace,
): string {
  if (role === "advisor") return decisionPrompts.advisorWorkspaceBlock(workspace);
  if (role === "triage") return triagePrompts.triageWorkspaceBlock(workspace);
  return prompts.workspaceBlock(role, workspace);
}

const threadWorkspace = { block, prepare };

export default threadWorkspace;
