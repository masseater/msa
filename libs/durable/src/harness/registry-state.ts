import compaction from "./compaction.ts";
import generation from "./generation.ts";
import toolModule from "./tool.ts";
import type typesModule from "./types.types.ts";

const { GenerationTask } = generation;
const { ToolTask } = toolModule;
const { CompactionTask } = compaction;

const BUILTIN_TASKS: readonly typesModule.AnyTask[] = [GenerationTask, ToolTask, CompactionTask];

class RegistryState<
  Tool extends typesModule.ToolRegistration,
> implements typesModule.RegistrySnapshot<Tool> {
  readonly #extensions: readonly typesModule.Extension<Tool>[];
  readonly #byName: ReadonlyMap<string, typesModule.Extension<Tool>>;
  readonly #tasks: ReadonlyMap<string, typesModule.AnyTask>;

  constructor(extensions: readonly typesModule.Extension<Tool>[]) {
    this.#extensions = extensions;
    this.#byName = new Map(extensions.map((extension) => [extension.name, extension]));
    const tasks = new Map<string, typesModule.AnyTask>();
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

  installed(): readonly typesModule.Extension<Tool>[] {
    return this.#extensions;
  }

  extension(name: string): typesModule.Extension<Tool> | undefined {
    return this.#byName.get(name);
  }

  tools(): readonly { readonly extension: typesModule.Extension<Tool>; readonly tool: Tool }[] {
    return this.#extensions.flatMap((extension) =>
      (extension.tools ?? []).map((tool) => ({ extension, tool })),
    );
  }

  sections(): readonly {
    readonly extension: typesModule.Extension<Tool>;
    readonly section: typesModule.PromptSection<Tool>;
  }[] {
    return this.#extensions.flatMap((extension) =>
      (extension.sections ?? []).map((section) => ({ extension, section })),
    );
  }

  tasks(): readonly typesModule.AnyTask[] {
    return [...this.#tasks.values()];
  }

  task(name: string): typesModule.AnyTask | undefined {
    return this.#tasks.get(name);
  }
}

const registryState = {
  BUILTIN_TASKS,
  RegistryState,
};

export default registryState;
