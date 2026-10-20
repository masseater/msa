import { Effect, FileSystem } from "effect";
import { ChildProcess } from "effect/process";

import { stripBom } from "../../utils/text.ts";
import { join } from "../path.ts";
import { nodeRuntime } from "../services.ts";

export interface ExternalEditorOptions {
  command: string;
  content: string;
}

export type ExternalEditorResult = { status: "complete"; content: string } | { status: "failed" };

export function editInExternalEditor(
  options: ExternalEditorOptions,
): Promise<ExternalEditorResult> {
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
