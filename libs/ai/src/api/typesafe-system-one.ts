import type { ClassifierFunction, ClassifierOptions } from "../types.ts";
import { modelCall } from "../utils/model-call.ts";
import { isRecord } from "./classifier-shared.ts";
import { classifySystemOne, type SystemOneTransport } from "./system-one-shared.ts";

const transport: SystemOneTransport = {
  api: "typesafe-system-one",
  label: "System One API",
  url: (model) => new URL("systemone", `${model.baseUrl.replace(/\/+$/u, "")}/`),
  payload: (model, request) => ({ model: model.id, ...request }),
  output: (body) => {
    if (!isRecord(body)) throw new Error("System One API returned an unexpected response");
    return body;
  },
};

export const classify = modelCall<
  Parameters<ClassifierFunction<ClassifierOptions>>[0],
  Parameters<ClassifierFunction<ClassifierOptions>>[1],
  NonNullable<Parameters<ClassifierFunction<ClassifierOptions>>[2]>,
  ReturnType<ClassifierFunction<ClassifierOptions>>
>((model, context, options) => classifySystemOne(transport, model, context, options));
