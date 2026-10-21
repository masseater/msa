import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";

import bash from "./bash.ts";
import grep from "./grep.ts";
import ops from "./ops.ts";
import paths from "./paths.ts";
import vmModule from "./vm.ts";

const {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} = codingAgent;
const { createGondolinBashOps } = bash;
const { executeGondolinGrep } = grep;
const {
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} = ops;
const { GUEST_WORKSPACE } = paths;
const { createVmHandle } = vmModule;

type VmHandle = ReturnType<typeof createVmHandle>;

function registerLifecycle(msa: codingAgentTypes.ExtensionAPI, vm: VmHandle, localCwd: string) {
  msa.on("session_start", (_event, ctx) => vm.ensure(ctx).then(() => undefined));
  msa.on("session_shutdown", (_event, ctx) => vm.stop(ctx));
  msa.registerCommand("gondolin", {
    description: "Show Gondolin VM status",
    handler: (_args, ctx) =>
      vm
        .ensure(ctx)
        .then((activeVm) =>
          ctx.ui.notify(
            [
              `Gondolin VM: ${activeVm.id}`,
              `Host workspace: ${localCwd}`,
              `Guest workspace: ${GUEST_WORKSPACE}`,
              `Shell: ${vm.shellPath()}`,
            ].join("\n"),
            "info",
          ),
        ),
  });
  msa.on("user_bash", (_event, ctx) =>
    vm.ensure(ctx).then((activeVm) => ({
      operations: createGondolinBashOps(activeVm, localCwd, vm.shellPath()),
    })),
  );
  msa.on("before_agent_start", (event, ctx) =>
    vm.ensure(ctx).then(() => {
      const localLine = `Current working directory: ${localCwd}`;
      const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${localCwd})`;
      const systemPrompt = event.systemPrompt.includes(localLine)
        ? event.systemPrompt.replace(localLine, guestLine)
        : `${event.systemPrompt}\n\n${guestLine}`;
      return { systemPrompt };
    }),
  );
}

function registerFileTools(msa: codingAgentTypes.ExtensionAPI, vm: VmHandle, localCwd: string) {
  msa.registerTool({
    ...createReadTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createReadTool(GUEST_WORKSPACE, {
          operations: createGondolinReadOps(activeVm, localCwd),
        }).execute(id, params, signal, onUpdate),
      ),
  });
  msa.registerTool({
    ...createWriteTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createWriteTool(GUEST_WORKSPACE, {
          operations: createGondolinWriteOps(activeVm, localCwd),
        }).execute(id, params, signal, onUpdate),
      ),
  });
  msa.registerTool({
    ...createEditTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createEditTool(GUEST_WORKSPACE, {
          operations: createGondolinEditOps(activeVm, localCwd),
        }).execute(id, params, signal, onUpdate),
      ),
  });
  msa.registerTool({
    ...createBashTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createBashTool(GUEST_WORKSPACE, {
          operations: createGondolinBashOps(activeVm, localCwd, vm.shellPath()),
        }).execute(id, params, signal, onUpdate),
      ),
  });
}

function registerSearchTools(msa: codingAgentTypes.ExtensionAPI, vm: VmHandle, localCwd: string) {
  msa.registerTool({
    ...createLsTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createLsTool(GUEST_WORKSPACE, {
          operations: createGondolinLsOps(activeVm, localCwd),
        }).execute(id, params, signal, onUpdate),
      ),
  });
  msa.registerTool({
    ...createFindTool(localCwd),
    execute: (id, params, signal, onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) =>
        createFindTool(GUEST_WORKSPACE, {
          operations: createGondolinFindOps(activeVm, localCwd),
        }).execute(id, params, signal, onUpdate),
      ),
  });
  msa.registerTool({
    ...createGrepTool(localCwd),
    execute: (_id, params, signal, _onUpdate, ctx) =>
      vm.ensure(ctx).then((activeVm) => executeGondolinGrep(activeVm, localCwd, params, signal)),
  });
}

export default function (msa: codingAgentTypes.ExtensionAPI) {
  const localCwd = process.cwd();
  const vm = createVmHandle(localCwd);
  registerLifecycle(msa, vm, localCwd);
  registerFileTools(msa, vm, localCwd);
  registerSearchTools(msa, vm, localCwd);
}
