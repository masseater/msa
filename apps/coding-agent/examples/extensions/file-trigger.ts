import { Effect, FileSystem, ManagedRuntime, Stream } from "effect";

import { NodeServices } from "@effect/platform-node";

import type { ExtensionAPI } from "@msa/coding-agent";

const TRIGGER_FILE = "/tmp/agent-trigger.txt";

const runtime = ManagedRuntime.make(NodeServices.layer);

const readTrigger = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.readFileString(TRIGGER_FILE)).trim();
});

const clearTrigger = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(TRIGGER_FILE, "");
});

const handleChange = (onContent: (content: string) => void) =>
  Effect.gen(function* () {
    const content = yield* readTrigger;
    if (content.length === 0) return;
    onContent(content);
    yield* clearTrigger;
  }).pipe(Effect.ignore);

const watchTrigger = (onContent: (content: string) => void) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const watcher = fs.watch(TRIGGER_FILE);
    yield* Stream.runForEach(watcher, () => handleChange(onContent));
  });

export default function (msa: ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    runtime.runFork(
      watchTrigger((content) => {
        msa.sendMessage(
          {
            customType: "file-trigger",
            content: `External trigger: ${content}`,
            display: true,
          },
          { triggerTurn: true },
        );
      }),
    );

    if (ctx.hasUI) {
      ctx.ui.notify(`Watching ${TRIGGER_FILE}`, "info");
    }
  });
}
