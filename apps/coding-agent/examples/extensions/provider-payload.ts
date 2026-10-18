import { NodeServices } from "@effect/platform-node";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@msa/coding-agent";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";

const runtime = ManagedRuntime.make(NodeServices.layer);

const appendPayloadLog = (cwd: string, line: string): void => {
  runtime.runSync(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(path.join(cwd, CONFIG_DIR_NAME, "provider-payload.log"), line, {
        flag: "a",
      });
    }).pipe(Effect.orDie),
  );
};

export default function (msa: ExtensionAPI) {
  msa.on("before_provider_request", (event, ctx) => {
    appendPayloadLog(ctx.cwd, `${JSON.stringify(event.payload, null, 2)}\n\n`);
  });

  msa.on("after_provider_response", (event, ctx) => {
    appendPayloadLog(ctx.cwd, `[${event.status}] ${JSON.stringify(event.headers)}\n\n`);
  });
}
