import type runnerContextEmitterTypes from "./runner-context-emitter.types.ts";
import type runnerLifecycleEmitterTypes from "./runner-lifecycle-emitter.types.ts";

declare namespace runnerEmittersTypes {
  interface Emitters {
    lifecycle: runnerLifecycleEmitterTypes.LifecycleEmitter;
    context: runnerContextEmitterTypes.ContextEmitter;
  }
}

export type { runnerEmittersTypes as default };
