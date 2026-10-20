import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import clock from "../utils/clock.ts";
import errorBody from "../utils/error-body.ts";
import headersModule from "../utils/headers.ts";
import hooks from "../utils/hooks.ts";
import modelCallModule from "../utils/model-call.ts";
import openrouterImagesRequest from "./openrouter-images-request.ts";
import openrouterImagesResponse from "./openrouter-images-response.ts";

const { buildParams, requestImages } = openrouterImagesRequest;
const { callHook } = hooks;
const { headersToRecord } = headersModule;
const { applyImagesResponse } = openrouterImagesResponse;
const { modelCall } = modelCallModule;
const { currentTimeMillis } = clock;
const { formatProviderError, normalizeProviderError } = errorBody;

const runImagesRequest = Effect.fn("runImagesRequest")(function* (
  model: typesModule.ImageModel<typesModule.ImageApi>,
  context: typesModule.ImagesContext,
  options: typesModule.ImagesOptions | undefined,
  output: typesModule.AssistantImages,
) {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  let params = buildParams({ context, model });
  const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
  if (nextParams !== undefined) {
    params = nextParams as typeof params;
  }
  const { data: response, response: rawResponse } = yield* requestImages({
    apiKey,
    model,
    options,
    params,
  });
  yield* callHook(() =>
    options?.onResponse?.(
      { headers: headersToRecord(rawResponse.headers), status: rawResponse.status },
      model,
    ),
  );
  applyImagesResponse({ model, output, response });
  return output;
});

const generateImages = modelCall<
  Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[0],
  Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[1],
  NonNullable<Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[2]>,
  ReturnType<typesModule.ImagesFunction<typesModule.ImagesOptions>>
>(
  (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    context: typesModule.ImagesContext,
    options?: typesModule.ImagesOptions,
  ) => {
    const output: typesModule.AssistantImages = {
      api: model.api,
      model: model.id,
      output: [],
      provider: model.provider,
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
  },
);

const openrouterImages = {
  generateImages,
};

export default openrouterImages;
