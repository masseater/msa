import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";
import { Type } from "typebox";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("quit", {
    description: "Exit msa cleanly",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.shutdown();
        }),
      ),
  });

  msa.registerTool({
    name: "finish_and_exit",
    label: "Finish and Exit",
    description: "Complete a task and exit msa",
    parameters: Type.Object({}),
    execute: (_toolCallId, _params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.shutdown();

          return {
            content: [{ type: "text", text: "Shutdown requested. Exiting after this response." }],
            details: {},
          };
        }),
      ),
  });

  msa.registerTool({
    name: "deploy_and_exit",
    label: "Deploy and Exit",
    description: "Deploy the application and exit msa",
    parameters: Type.Object({
      environment: Type.String({ description: "Target environment (e.g., production, staging)" }),
    }),
    execute: (_toolCallId, params, _signal, onUpdate, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          onUpdate?.({
            content: [{ type: "text", text: `Deploying to ${params.environment}...` }],
            details: {},
          });

          onUpdate?.({
            content: [{ type: "text", text: "Deployment complete, exiting..." }],
            details: {},
          });
          ctx.shutdown();

          return {
            content: [{ type: "text", text: "Done! Shutdown requested." }],
            details: { environment: params.environment },
          };
        }),
      ),
  });
}
