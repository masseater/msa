import type aiTypes from "@msa/ai/index.types";

function model(provider: string, id: string): aiTypes.Model<aiTypes.Api> {
  return { id, name: id, provider } as unknown as aiTypes.Model<aiTypes.Api>;
}

const modelLifecycleSupport = {
  model,
};

export default modelLifecycleSupport;
