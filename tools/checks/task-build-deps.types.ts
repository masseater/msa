import type { Effect } from "effect";

import type shellSyntaxTypes from "./shell-syntax.types.ts";
import type taskCommandTypes from "./task-commands.types.ts";
import type vitestImportsTypes from "./vitest-imports.types.ts";

declare namespace taskBuildDepsTypes {
  type Problems = Effect.Effect<ReadonlyArray<string>>;

  interface TaskDef {
    readonly command: string;
    readonly cwd: string;
    readonly dependsOn: ReadonlyArray<string>;
    readonly inputs?: ReadonlyArray<string> | undefined;
  }

  type Tasks = Readonly<Record<string, TaskDef>>;

  interface Workspace extends taskCommandTypes.PackageEntry {
    readonly dir: string;
    readonly name: string;
    readonly scripts: Readonly<Record<string, string>>;
  }

  interface Paths {
    readonly basename: (file: string) => string;
    readonly dirname: (file: string) => string;
    readonly relative: (from: string, to: string) => string;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
  }

  interface Host {
    readonly isFile: (file: string) => Effect.Effect<boolean>;
    readonly list: (dir: string) => Effect.Effect<ReadonlyArray<string>>;
    readonly path: Paths;
    readonly read: (file: string) => Effect.Effect<string>;
  }

  interface Scope extends Host {
    readonly imports: Map<string, vitestImportsTypes.Imports>;
    readonly root: string;
    readonly workspaces: ReadonlyArray<Workspace>;
  }

  type Resolution = { readonly file: string | undefined } | { readonly problem: string };

  interface Step {
    readonly built: boolean;
    readonly cwd: string;
    readonly inputs?: ReadonlyArray<string> | undefined;
    readonly via: ReadonlyArray<string>;
    readonly workspace: Workspace;
  }

  interface Checked {
    readonly end: Step;
    readonly problems: ReadonlyArray<string>;
  }

  interface Walker {
    readonly run: (step: Step, name: string) => Problems;
    readonly script: (step: Step, script: shellSyntaxTypes.Script) => Effect.Effect<Checked>;
  }

  interface Call {
    readonly args: ReadonlyArray<shellSyntaxTypes.Word>;
    readonly graph: Graph;
    readonly step: Step;
    readonly text: string;
    readonly walker: Walker;
  }

  interface VitestRun {
    readonly cwd: string;
    readonly inputs?: ReadonlyArray<string> | undefined;
    readonly projects: ReadonlyArray<string>;
  }

  interface Graph {
    readonly flags: taskCommandTypes.NodeFlags;
    readonly parse: shellSyntaxTypes.Parse;
    readonly readScript: (file: string) => Effect.Effect<string | undefined>;
    readonly relative: (file: string) => string;
    readonly resolve: (dir: string, relative: string) => string;
    readonly root: string;
    readonly tasks: Tasks;
    readonly walkNode: (step: Step, run: taskCommandTypes.NodeRun, label: string) => Problems;
    readonly walkVitest: (run: VitestRun, label: string) => Problems;
    readonly workspaces: ReadonlyArray<Workspace>;
  }
}

export type { taskBuildDepsTypes as default };
