import { NodeServices } from "@effect/platform-node";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";

const { CONFIG_DIR_NAME } = codingAgent;

const runtime = ManagedRuntime.make(NodeServices.layer);

const appendPayloadLog = (cwd: string, line: string): Promise<void> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(path.join(cwd, CONFIG_DIR_NAME, "provider-payload.log"), line, {
        flag: "a",
      });
    }).pipe(Effect.orDie),
  );

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("before_provider_request", (event, ctx) =>
    appendPayloadLog(ctx.cwd, `${JSON.stringify(event.payload, null, 2)}\n\n`),
  );

  msa.on("after_provider_response", (event, ctx) =>
    appendPayloadLog(ctx.cwd, `[${event.status}] ${JSON.stringify(event.headers)}\n\n`),
  );
}
