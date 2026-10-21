import { Effect, FileSystem } from "effect";
import { ChildProcess } from "effect/process";

import platformModule from "../../core/platform/index.ts";
import nodeRuntime from "../../core/platform/runtime.ts";
import text from "../../utils/text.ts";
import type externalEditorTypes from "./external-editor.types.ts";

const { join } = platformModule;
const { stripBom } = text;

function editInExternalEditor(
  options: externalEditorTypes.ExternalEditorOptions,
): Promise<externalEditorTypes.ExternalEditorResult> {
  return nodeRuntime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "msa-editor-" });
        const filePath = join(directory, "prompt.md");
        yield* fileSystem.writeFileString(filePath, options.content);
        const [editor, ...editorArgs] = options.command.split(" ");
        if (editor === undefined) return { status: "failed" } as const;
        process.stdout.write(
          `Launching external editor: ${options.command}\nPi will resume when the editor exits.\n`,
        );

        const exitCode = yield* ChildProcess.make(editor, [...editorArgs, filePath], {
          shell: process.platform === "win32",
          stderr: "inherit",
          stdin: "inherit",
          stdout: "inherit",
        }).pipe(
          Effect.flatMap((handle) => handle.exitCode),
          Effect.orElseSucceed(() => null),
        );
        if (exitCode !== 0) return { status: "failed" } as const;

        const edited = yield* fileSystem.readFileString(filePath);
        return { content: stripBom(edited).replace(/\n$/u, ""), status: "complete" } as const;
      }),
    ).pipe(Effect.orDie),
  );
}

function editWhileSuspended(
  ui: externalEditorTypes.SuspendableUi,
  options: externalEditorTypes.ExternalEditorOptions,
  applyEdit: (content: string) => void,
): Effect.Effect<void> {
  const edit = Effect.promise(() => editInExternalEditor(options)).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        if (result.status === "complete") applyEdit(result.content);
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        ui.start();
        ui.requestRender(true);
      }),
    ),
  );
  return Effect.sync(() => ui.stop()).pipe(Effect.andThen(edit));
}

const externalEditor = {
  editInExternalEditor,
  editWhileSuspended,
};

export default externalEditor;
