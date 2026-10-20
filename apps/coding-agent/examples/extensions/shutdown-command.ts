import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";
import { Type } from "typebox";

const registerQuit = (msa: ExtensionAPI): void => {
  msa.registerCommand("quit", {
    description: "Exit msa cleanly",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.shutdown();
        }),
      ),
  });
};

const registerFinishAndExit = (msa: ExtensionAPI): void => {
  msa.registerTool({
    description: "Complete a task and exit msa",
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
    label: "Finish and Exit",
    name: "finish_and_exit",
    parameters: Type.Object({}),
  });
};

const registerDeployAndExit = (msa: ExtensionAPI): void => {
  msa.registerTool({
    description: "Deploy the application and exit msa",
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
    label: "Deploy and Exit",
    name: "deploy_and_exit",
    parameters: Type.Object({
      environment: Type.String({ description: "Target environment (e.g., production, staging)" }),
    }),
  });
};

export default function (msa: ExtensionAPI) {
  registerQuit(msa);
  registerFinishAndExit(msa);
  registerDeployAndExit(msa);
}
