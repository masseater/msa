import type aiTypes from "@msa/ai/index.types";

import modelPolicy from "./model-policy.ts";
import type modelPolicyTypes from "./model-policy.types.ts";
import modelResolver from "./model-resolver.ts";

const { describeModelPolicyDenial } = modelPolicy;
const { resolveModelReference } = modelResolver;

function findModelPolicyDenial(options: {
  reference: string;
  provider?: string | undefined;
  policy: modelPolicyTypes.ModelPolicy;
  catalogModels: readonly aiTypes.Model<aiTypes.Api>[];
}): { model: aiTypes.Model<aiTypes.Api>; message: string } | undefined {
  const result = resolveModelReference(
    {
      fuzzy: true,
      provider: options.provider,
      text: options.reference,
      thinkingSuffix: "lenient",
    },
    options.catalogModels,
    () => true,
  );
  const candidates =
    result.status === "resolved"
      ? [result.model]
      : result.status === "ambiguous"
        ? result.candidates
        : [];
  for (const model of candidates) {
    const message = describeModelPolicyDenial(options.policy, model);
    if (message !== undefined && message !== "") return { message, model };
  }
  return undefined;
}

function formatModelPolicyDenialError(denial: {
  model: aiTypes.Model<aiTypes.Api>;
  message: string;
}): string {
  return `Model "${denial.model.provider}/${denial.model.id}" is ${denial.message}. Open /model to change it.`;
}

const modelPolicyDenial = { findModelPolicyDenial, formatModelPolicyDenialError };

export default modelPolicyDenial;
