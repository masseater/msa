import type LifecycleEmitterClass from "./runner-lifecycle-emitter.ts";

declare namespace runnerLifecycleEmitterTypes {
  type LifecycleEmitter = (typeof LifecycleEmitterClass)["prototype"];
}

export type { runnerLifecycleEmitterTypes as default };
