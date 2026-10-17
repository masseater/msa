import { CompactionTask } from "./compaction.ts";
import { GenerationTask } from "./generation.ts";
import { ToolTask } from "./tool.ts";
import type {
  AnyTask,
  Extension,
  PromptSection,
  RegistrySnapshot,
  ToolRegistration,
} from "./types.ts";

export const BUILTIN_TASKS: readonly AnyTask[] = [GenerationTask, ToolTask, CompactionTask];

export class RegistryState<Tool extends ToolRegistration> implements RegistrySnapshot<Tool> {
  readonly #extensions: readonly Extension<Tool>[];
  readonly #byName: ReadonlyMap<string, Extension<Tool>>;
  readonly #tasks: ReadonlyMap<string, AnyTask>;

  constructor(extensions: readonly Extension<Tool>[]) {
    this.#extensions = extensions;
    this.#byName = new Map(extensions.map((extension) => [extension.name, extension]));
    const tasks = new Map<string, AnyTask>();
    for (const task of BUILTIN_TASKS) tasks.set(task.definition.name, task);
    for (const extension of extensions) {
      for (const task of extension.tasks ?? []) {
        const name = task.definition.name;
        if (tasks.has(name))
          throw new Error(`Task ${name} of extension ${extension.name} is already installed`);
        tasks.set(name, task);
      }
    }
    this.#tasks = tasks;
  }

  installed(): readonly Extension<Tool>[] {
    return this.#extensions;
  }

  extension(name: string): Extension<Tool> | undefined {
    return this.#byName.get(name);
  }

  tools(): readonly { readonly extension: Extension<Tool>; readonly tool: Tool }[] {
    return this.#extensions.flatMap((extension) =>
      (extension.tools ?? []).map((tool) => ({ extension, tool })),
    );
  }

  sections(): readonly {
    readonly extension: Extension<Tool>;
    readonly section: PromptSection<Tool>;
  }[] {
    return this.#extensions.flatMap((extension) =>
      (extension.sections ?? []).map((section) => ({ extension, section })),
    );
  }

  tasks(): readonly AnyTask[] {
    return [...this.#tasks.values()];
  }

  task(name: string): AnyTask | undefined {
    return this.#tasks.get(name);
  }
}
