import { ContextEmitter } from "./runner-context-emitter.ts";
import type { EmitHost } from "./runner-invoker.ts";
import { LifecycleEmitter } from "./runner-lifecycle-emitter.ts";

export interface Emitters {
  lifecycle: LifecycleEmitter;
  context: ContextEmitter;
}

export const createEmitters = (host: EmitHost): Emitters => ({
  lifecycle: new LifecycleEmitter(host),
  context: new ContextEmitter(host),
});
