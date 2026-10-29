import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vite-plus/test";

import htmlDocumentModule from "../../libs/ai/src/utils/html-document.ts";
import scriptOutput from "../../libs/ai/src/utils/script-output.ts";
import type scriptOutputTypes from "../../libs/ai/src/utils/script-output.types.ts";

const { ScriptOutput, scriptOutputLayer } = scriptOutput;
const { htmlDocument } = htmlDocumentModule;

const PAGE = "<!doctype html><script>x</script>";

const runtime = ManagedRuntime.make(Layer.mergeAll(scriptOutputLayer, NodeServices.layer));

const inTempDirectory = <A, E>(
  body: (
    root: string,
  ) => Effect.Effect<A, E, FileSystem.FileSystem | scriptOutputTypes.ScriptOutput>,
) =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* body(yield* fs.makeTempDirectoryScoped({ prefix: "msa-script-output-" }));
      }),
    ),
  );

const refusal = (write: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(write);
    expect(Exit.isFailure(exit)).toBe(true);
    return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";
  });

it("refuses an .html destination for text, whatever path the caller passes", () =>
  inTempDirectory((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const output = yield* ScriptOutput;
      const args = { output: `${root}/report.html` };
      expect(yield* refusal(output.writeTextFile(args.output, PAGE))).toContain("writeHtmlReport");
      expect(yield* refusal(output.writeTextFile(`${root}/report`, PAGE))).toContain(".txt");
      expect(yield* fs.exists(args.output)).toBe(false);
      yield* output.writeTextFile(`${root}/report.txt`, "text");
      expect(yield* fs.readFileString(`${root}/report.txt`)).toBe("text");
    }),
  ));

it("writes .html only from an HtmlDocument, which carries the CSP and no script", () =>
  inTempDirectory((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const output = yield* ScriptOutput;
      const document = htmlDocument({ body: PAGE, style: "", title: "report" });
      expect(yield* refusal(output.writeHtmlReport(`${root}/report.txt`, document))).toContain(
        ".html",
      );
      yield* output.writeHtmlReport(`${root}/report.html`, document);
      const html = yield* fs.readFileString(`${root}/report.html`);
      expect(html).toContain("default-src 'none'");
      expect(html.toLowerCase()).not.toContain("<script");
    }),
  ));

it("refuses to copy, move, or link a file into another extension", () =>
  inTempDirectory((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const output = yield* ScriptOutput;
      yield* output.writeTextFile(`${root}/page.txt`, PAGE);
      for (const place of [
        output.copyFileTo,
        output.copyTreeTo,
        output.movePath,
        output.linkPath,
      ]) {
        expect(yield* refusal(place(`${root}/page.txt`, `${root}/page.html`))).toContain(".txt");
      }
      expect(yield* fs.exists(`${root}/page.html`)).toBe(false);
    }),
  ));

const spawnRefusal = (options: scriptOutputTypes.CommandOptions) =>
  Effect.gen(function* () {
    const { processes } = yield* ScriptOutput;
    return yield* refusal(Effect.scoped(Effect.asVoid(processes.spawn(options))));
  });

it("starts a built msa binary only when the path names msa", () =>
  inTempDirectory((root) =>
    Effect.gen(function* () {
      expect(
        yield* spawnRefusal({
          args: [`${root}/page.html`],
          command: { msaBinary: "/usr/bin/tee" },
        }),
      ).toContain("not an msa binary");
      const { exitCode, stdout } = yield* (yield* ScriptOutput).processes.run({
        args: ["--version"],
        command: "node",
      });
      expect({ exitCode, stdout: stdout.trim() }).toEqual({ exitCode: 0, stdout: process.version });
    }),
  ));
