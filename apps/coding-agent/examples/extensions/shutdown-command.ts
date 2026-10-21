import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

const registerQuit = (msa: codingAgentTypes.ExtensionAPI): void => {
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

const registerFinishAndExit = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerTool({
    description: "Complete a task and exit msa",
    execute: (_toolCallId, _params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.shutdown();

          return {
            content: [{ text: "Shutdown requested. Exiting after this response.", type: "text" }],
            details: {},
          };
        }),
      ),
    label: "Finish and Exit",
    name: "finish_and_exit",
    parameters: Type.Object({}),
  });
};

const registerDeployAndExit = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerTool({
    description: "Deploy the application and exit msa",
    execute: (_toolCallId, params, _signal, onUpdate, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          onUpdate?.({
            content: [{ text: `Deploying to ${params.environment}...`, type: "text" }],
            details: {},
          });

          onUpdate?.({
            content: [{ text: "Deployment complete, exiting...", type: "text" }],
            details: {},
          });
          ctx.shutdown();

          return {
            content: [{ text: "Done! Shutdown requested.", type: "text" }],
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

export default function (msa: codingAgentTypes.ExtensionAPI) {
  registerQuit(msa);
  registerFinishAndExit(msa);
  registerDeployAndExit(msa);
}
