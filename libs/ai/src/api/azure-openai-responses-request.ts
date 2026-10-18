import { AzureOpenAI } from "openai";

import type { Model, TranscriptContext } from "../types.ts";
import { getDeclaredTools } from "../utils/transcript.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { resolveAzureConfig, resolveDeploymentName } from "./azure-openai-config.ts";
import {
  type AzureOpenAIResponsesOptions,
  buildAzureResponsesParams,
} from "./azure-openai-responses-params.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import type { ResponsesRequest } from "./openai-responses-run.ts";

type AzureModel = Model<"azure-openai-responses">;

export function requireAzureApiKey(
  model: Pick<AzureModel, "provider">,
): (options: Pick<AzureOpenAIResponsesOptions, "apiKey"> | undefined) => string {
  return (options) => {
    const apiKey = options?.apiKey;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    return apiKey;
  };
}

function createClient(model: AzureModel, options: AzureOpenAIResponsesOptions | undefined) {
  const apiKey = requireAzureApiKey(model)(options);
  const { baseUrl, apiVersion } = resolveAzureConfig(model, options);
  return new AzureOpenAI({
    apiKey,
    apiVersion,
    dangerouslyAllowBrowser: true,
    fetch: options?.fetch,
    defaultHeaders: { "User-Agent": getMsaUserAgent(), ...model.headers, ...options?.headers },
    baseURL: baseUrl,
  });
}

export interface AzureResponsesRequestSpec {
  readonly model: AzureModel;
  readonly context: TranscriptContext;
  readonly options: AzureOpenAIResponsesOptions | undefined;
}

export function prepareAzureResponsesRequest({
  model,
  context,
  options,
}: AzureResponsesRequestSpec): ResponsesRequest {
  const deploymentName = resolveDeploymentName(model, options);
  const client = createClient(model, options);
  const grammarToolInputProperties = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    model.compat?.supportsOpenAIGrammarTools ?? false,
  );
  return {
    client,
    params: buildAzureResponsesParams({
      model,
      context,
      options,
      deploymentName,
      grammarToolInputProperties,
    }),
    streamOptions: {
      onProviderStreamEvent: options?.onProviderStreamEvent,
      grammarToolInputProperties,
    },
  };
}
