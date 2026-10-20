import ContextEmitter from "./runner-context-emitter.ts";
import type runnerEmittersTypes from "./runner-emitters.types.ts";
import type runnerInvokerTypes from "./runner-invoker.types.ts";
import LifecycleEmitter from "./runner-lifecycle-emitter.ts";
const createEmitters = (host: runnerInvokerTypes.EmitHost): runnerEmittersTypes.Emitters => ({
  context: new ContextEmitter(host),
  lifecycle: new LifecycleEmitter(host),
});

const runnerEmitters = {
  createEmitters,
};

export default runnerEmitters;
