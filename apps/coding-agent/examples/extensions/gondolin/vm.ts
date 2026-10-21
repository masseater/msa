import { RealFSProvider, VM } from "@earendil-works/gondolin";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import platform from "../../../src/core/platform/index.ts";
import paths from "./paths.ts";

const { GUEST_WORKSPACE } = paths;

type Context = codingAgentTypes.ExtensionContext | undefined;

interface VmState {
  vm: VM | undefined;
  starting: Promise<VM> | undefined;
  shellPath: string;
}

const startVm = (state: VmState, localCwd: string, ctx: Context): Promise<VM> =>
  Effect.runPromise(
    Effect.gen(function* () {
      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg("accent", `Gondolin: starting ${GUEST_WORKSPACE}`),
      );
      const created = yield* Effect.promise(() =>
        VM.create({
          sessionLabel: `msa ${platform.basename(localCwd)}`,
          vfs: { mounts: { [GUEST_WORKSPACE]: new RealFSProvider(localCwd) } },
        }),
      );
      const bashProbe = yield* Effect.promise(() =>
        created.exec(["/bin/sh", "-lc", "command -v bash || true"]),
      );
      const probed = bashProbe.stdout.trim();
      state.shellPath = probed === "" ? "/bin/sh" : probed;
      state.vm = created;
      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg("accent", `Gondolin: ${created.id.slice(0, 8)} (${GUEST_WORKSPACE})`),
      );
      ctx?.ui.notify(`Gondolin VM ready. ${localCwd} is mounted at ${GUEST_WORKSPACE}.`, "info");
      return created;
    }),
  );

function createVmHandle(localCwd: string) {
  const state: VmState = { shellPath: "/bin/sh", starting: undefined, vm: undefined };
  const ensure = (ctx?: Context): Promise<VM> => {
    if (state.vm !== undefined) return Promise.resolve(state.vm);
    state.starting ??= startVm(state, localCwd, ctx).finally(() => {
      state.starting = undefined;
    });
    return state.starting;
  };
  const stop = (ctx: codingAgentTypes.ExtensionContext): Promise<void> => {
    const activeVm = state.vm;
    state.vm = undefined;
    state.starting = undefined;
    if (activeVm === undefined) return Promise.resolve();
    ctx.ui.setStatus("gondolin", ctx.ui.theme.fg("muted", "Gondolin: stopping"));
    return activeVm.close().finally(() => ctx.ui.setStatus("gondolin", undefined));
  };
  return { ensure, shellPath: () => state.shellPath, stop };
}

const vmModule = { createVmHandle };

export default vmModule;
