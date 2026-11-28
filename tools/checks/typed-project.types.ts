import type { SourceFile } from "typescript/ast";
import type { Project } from "typescript/sync";

declare namespace typedProjectTypes {
  type Scope = {
    readonly files: (name: string) => boolean;
    readonly project?: string | undefined;
    readonly root: string;
  };

  type FileScan<F> = (project: Project, file: SourceFile, relative: string) => readonly F[];
}

export type { typedProjectTypes as default };
