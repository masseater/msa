import type { ExtensionAPI } from "@msa/coding-agent";
import { Console, Effect } from "effect";

export default function (msa: ExtensionAPI) {
  msa.on("model_select", (event, ctx) => {
    const { model, previousModel, source } = event;

    const next = `${model.provider}/${model.id}`;
    const prev =
      previousModel === undefined ? "none" : `${previousModel.provider}/${previousModel.id}`;

    if (source !== "restore") {
      ctx.ui.notify(`Model: ${next}`, "info");
    }

    ctx.ui.setStatus("model", `🤖 ${model.id}`);

    Effect.runSync(Console.log(`[model_select] ${prev} → ${next} (${source})`));
  });
}
