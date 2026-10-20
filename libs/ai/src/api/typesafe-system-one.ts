import type typesModule from "../types.types.ts";
import modelCallModule from "../utils/model-call.ts";
import classifierShared from "./classifier-shared.ts";
import systemOneShared from "./system-one-shared.ts";
import type systemOneSharedTypes from "./system-one-shared.types.ts";

const { isRecord } = classifierShared;
const { modelCall } = modelCallModule;
const { classifySystemOne } = systemOneShared;

const transport: systemOneSharedTypes.SystemOneTransport = {
  api: "typesafe-system-one",
  label: "System One API",
  output: (body) => {
    if (!isRecord(body)) throw new Error("System One API returned an unexpected response");
    return body;
  },
  payload: (model, request) => ({ model: model.id, ...request }),
  url: (model) => new URL("systemone", `${model.baseUrl.replace(/\/+$/u, "")}/`),
};

const classify = modelCall<
  Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[0],
  Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[1],
  NonNullable<Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[2]>,
  ReturnType<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>
>((model, context, options) => classifySystemOne(transport, model, context, options));

const typesafeSystemOne = {
  classify,
};

export default typesafeSystemOne;
