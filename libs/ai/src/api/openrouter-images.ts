import { Effect } from "effect";

import type {
  AssistantImages,
  ImageApi,
  ImageModel,
  ImagesContext,
  ImagesFunction,
  ImagesOptions,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { modelCall } from "../utils/model-call.ts";
import { buildParams, requestImages } from "./openrouter-images-request.ts";
import { applyImagesResponse } from "./openrouter-images-response.ts";

const runImagesRequest = Effect.fn("runImagesRequest")(function* (
  model: ImageModel<ImageApi>,
  context: ImagesContext,
  options: ImagesOptions | undefined,
  output: AssistantImages,
) {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  let params = buildParams({ model, context });
  const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
  if (nextParams !== undefined) {
    params = nextParams as typeof params;
  }
  const { data: response, response: rawResponse } = yield* requestImages({
    model,
    apiKey,
    params,
    options,
  });
  yield* callHook(() =>
    options?.onResponse?.(
      { status: rawResponse.status, headers: headersToRecord(rawResponse.headers) },
      model,
    ),
  );
  applyImagesResponse({ output, response, model });
  return output;
});

export const generateImages = modelCall<
  Parameters<ImagesFunction<ImagesOptions>>[0],
  Parameters<ImagesFunction<ImagesOptions>>[1],
  NonNullable<Parameters<ImagesFunction<ImagesOptions>>[2]>,
  ReturnType<ImagesFunction<ImagesOptions>>
>((model: ImageModel<ImageApi>, context: ImagesContext, options?: ImagesOptions) => {
  const output: AssistantImages = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  };
  return Effect.runPromise(
    runImagesRequest(model, context, options, output).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
          output.errorMessage = formatProviderError(normalizeProviderError(error));
          return output;
        }),
      ),
    ),
  );
});
