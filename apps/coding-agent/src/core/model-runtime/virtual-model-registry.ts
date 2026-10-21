import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import virtualModelsModule from "../virtual-models.ts";

const { createVirtualModel, findLatestResponse } = virtualModelsModule;
const { clampThinkingLevel } = ai;
const { awaited, awaiting } = awaitingModule;

type Model = aiTypes.Model<aiTypes.Api>;

interface RegisteredVirtualModel {
  model: Model;
  route: modelRuntimeTypes.VirtualModelDefinition["route"];
}

interface PhysicalModels {
  getPhysicalModel(providerId: string, modelId: string): Model | undefined;
  hasConfiguredAuth(providerId: string): boolean;
}

export default class VirtualModelRegistry {
  private readonly entries = new Map<string, Map<string, RegisteredVirtualModel>>();

  providerIds(): Iterable<string> {
    return this.entries.keys();
  }

  modelsFor(providerId: string): readonly Model[] {
    return [...(this.entries.get(providerId)?.values() ?? [])].map((entry) => entry.model);
  }

  add(definition: modelRuntimeTypes.VirtualModelDefinition): void {
    const { provider: providerId, id } = definition;
    const models = this.entries.get(providerId) ?? new Map<string, RegisteredVirtualModel>();
    models.set(id, {
      model: createVirtualModel(definition),
      route: (request) => definition.route(request),
    });
    this.entries.set(providerId, models);
  }

  remove(providerId: string, id: string): boolean {
    const models = this.entries.get(providerId);
    if (models?.delete(id) !== true) return false;
    if (models.size === 0) this.entries.delete(providerId);
    return true;
  }

  route(
    model: Model,
    messages: readonly aiTypes.Message[],
    options: modelRuntimeTypes.ModelRouteOptions,
    physical: PhysicalModels,
  ): Promise<modelRuntimeTypes.ModelRoute> {
    const name = `Virtual model ${model.provider}/${model.id}`;
    const virtual = this.entries.get(model.provider)?.get(model.id);
    return Effect.runPromise(
      awaiting(function* () {
        if (virtual === undefined) throw new Error(`${name} is not registered.`);
        const { failed, ...request } = options;
        const latest = findLatestResponse(messages);
        const previousModel = latest && physical.getPhysicalModel(latest.provider, latest.model);
        const failedModel = failed && physical.getPhysicalModel(failed.provider, failed.model);
        const route = yield* awaited(
          virtual.route({
            ...request,
            failed: failedModel &&
              failed && {
                message: failed,
                model: failedModel,
                thinkingLevel: failed.thinkingLevel,
              },
            messages,
            model,
            previous: previousModel && {
              model: previousModel,
              thinkingLevel: latest?.thinkingLevel,
            },
          }),
        );
        const target = physical.getPhysicalModel(route.model.provider, route.model.id);
        const routed = `${name} routed to ${route.model.provider}/${route.model.id}`;
        if (target === undefined) throw new Error(`${routed}, which is not a physical model.`);
        if (!physical.hasConfiguredAuth(target.provider))
          throw new Error(`${routed}, which has no credentials.`);
        return {
          model: target,
          state: route.state,
          thinkingLevel: clampThinkingLevel(target, route.thinkingLevel),
        };
      }),
    );
  }
}
