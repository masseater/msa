import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import { expect, it } from "vite-plus/test";

import pullRequestSquashModule from "../../apps/coding-agent/src/core/orchestrator/pull-request-squash.ts";
import squashMessageModule from "../../apps/coding-agent/src/core/orchestrator/squash-message.ts";
import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { pullRequestSquash } = pullRequestSquashModule;
const { textOf } = squashMessageModule;

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const NONCE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SUBJECT = "fix(orchestrator): tell the harness's merge from others (#7)";

const commitlint = (message: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-merge-trailer-commitlint-" });
    const file = path.join(dir, "message.txt");
    yield* fs.writeFileString(file, message);
    return yield* captureProcess({
      args: ["--edit", file],
      command: path.join(root, "node_modules/.bin/commitlint"),
      cwd: root,
    });
  }).pipe(Effect.scoped);

const BODIES = {
  "a body": "Record a nonce before the merge request.\n\nRead the merge commit back to compare.",
  "commits squashed together":
    "fix(orchestrator): record a nonce\n\nBefore the request.\n\nfix(orchestrator): read it back\n\nAfter the merge.",
  "no body": "",
};

for (const [name, body] of Object.entries(BODIES)) {
  it(`passes commitlint with the Msa-Merge trailer appended to a squash message with ${name}`, () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const message = textOf(pullRequestSquash.withTrailer({ body, subject: SUBJECT }, NONCE));
        expect(message).toContain(`\n\nMsa-Merge: ${NONCE}\n`);
        expect(pullRequestSquash.carriesNonce(message, NONCE)).toBe(true);
        const result = yield* commitlint(message);
        expect(result.exitCode, `${result.stdout}${result.stderr}`).toBe(0);
      }),
    ));
}
