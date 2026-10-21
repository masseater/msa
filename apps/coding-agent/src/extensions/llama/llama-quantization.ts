import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import clientModule from "./client.ts";
import type huggingfaceTypes from "./huggingface.types.ts";
import type uiTypes from "./ui.types.ts";

const { formatBytes } = clientModule;
const { awaited, awaiting } = awaitingModule;

const quantizationLabel = (
  entry: huggingfaceTypes.HuggingFaceModelDetails["quantizations"][number],
) => {
  const detail = [
    entry.size === undefined ? undefined : formatBytes(entry.size),
    entry.name === "Q4_K_M" ? "recommended" : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return detail === "" ? entry.name : `${entry.name} · ${detail}`;
};

const chooseQuantization = (
  ui: uiTypes.LlamaUi,
  details: huggingfaceTypes.HuggingFaceModelDetails,
  requested: string | undefined,
): Promise<{ quantization: string | undefined } | undefined> =>
  Effect.runPromise(
    awaiting(function* () {
      if ((requested !== undefined && requested !== "") || details.quantizations.length === 0) {
        return { quantization: requested };
      }
      const options = details.quantizations.map(quantizationLabel);
      const choice = yield* awaited(ui.select(`Select quantization\n${details.id}`, options));
      if (choice === undefined || choice === "") return undefined;
      const quantization = details.quantizations[options.indexOf(choice)]?.name;
      return quantization === undefined || quantization === "" ? undefined : { quantization };
    }),
  );

const llamaQuantization = { chooseQuantization };

export default llamaQuantization;
