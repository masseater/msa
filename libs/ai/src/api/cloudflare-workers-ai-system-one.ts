import type { ClassifierFunction, ClassifierOptions } from "../types.ts";
import { isRecord } from "./classifier-shared.ts";
import { classifySystemOne, type SystemOneTransport } from "./system-one-shared.ts";

const LABEL = "Cloudflare Workers AI";

function cloudflareErrorMessage(errors: unknown): string {
  if (Array.isArray(errors)) {
    const messages = errors
      .map((error) =>
        isRecord(error) && typeof error["message"] === "string" ? error["message"] : undefined,
      )
      .filter((message): message is string => message !== undefined);
    if (messages.length > 0) return `${LABEL} error: ${messages.join("; ")}`;
  }
  return `${LABEL} request failed`;
}

const transport: SystemOneTransport = {
  api: "cloudflare-workers-ai-system-one",
  label: LABEL,
  url: (model) => new URL("run", `${model.baseUrl.replace(/\/+$/u, "")}/`),
  payload: (model, request) => ({ model: model.id, input: request }),
  output: (body) => {
    if (!isRecord(body)) throw new Error(`${LABEL} returned an unexpected response`);
    if (body["success"] === false) throw new Error(cloudflareErrorMessage(body["errors"]));
    const result = body["result"];
    if (!isRecord(result)) throw new Error(`${LABEL} returned an unexpected response`);
    if ("answers" in result) return result;
    if (result["state"] !== "Completed") {
      throw new Error(`${LABEL} run did not complete (state: ${String(result["state"])})`);
    }
    if (!isRecord(result["result"])) throw new Error(`${LABEL} returned an unexpected response`);
    return result["result"];
  },
};

export const classify: ClassifierFunction<ClassifierOptions> = (model, context, options) =>
  classifySystemOne(transport, model, context, options);
