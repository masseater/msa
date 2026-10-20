import { ContextEmitter } from "./runner-context-emitter.ts";
import type { EmitHost } from "./runner-invoker.ts";
import { LifecycleEmitter } from "./runner-lifecycle-emitter.ts";

export interface Emitters {
  lifecycle: LifecycleEmitter;
  context: ContextEmitter;
}

export const createEmitters = (host: EmitHost): Emitters => ({
  context: new ContextEmitter(host),
  lifecycle: new LifecycleEmitter(host),
});
