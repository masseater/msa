import agentModule from "./agent.ts";
import registryState from "./registry-state.ts";
import type typesModule from "./types.types.ts";

const { RegistryState } = registryState;
const { INSTRUCTIONS_KEY } = agentModule;

const SECTION_KEY = /^[a-z][a-z0-9_-]*$/u;

class RegistryImpl<
  Tool extends typesModule.ToolRegistration,
> implements typesModule.Registry<Tool> {
  #current = new RegistryState<Tool>([]);
  readonly #listeners = new Set<() => void>();

  snapshot(): typesModule.RegistrySnapshot<Tool> {
    return this.#current;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  install(extension: typesModule.Extension<Tool>): void {
    validateExtension(extension);
    const current = this.#current.installed();
    const index = current.findIndex((installed) => installed.name === extension.name);
    const next =
      index < 0
        ? [...current, extension]
        : current.map((installed, at) => (at === index ? extension : installed));
    this.#publish(next);
  }

  uninstall(extension: typesModule.Extension): void {
    const current = this.#current.installed();
    if (!current.some((installed) => installed.name === extension.name)) return;
    this.#publish(current.filter((installed) => installed.name !== extension.name));
  }

  #publish(extensions: readonly typesModule.Extension<Tool>[]): void {
    this.#current = new RegistryState(extensions);
    for (const listener of [...this.#listeners]) listener();
  }
}

function validateExtension(extension: typesModule.Extension): void {
  const tools = new Set<string>();
  for (const tool of extension.tools ?? []) {
    if (tools.has(tool.name))
      throw new Error(`Extension ${extension.name} has two tools named ${tool.name}`);
    tools.add(tool.name);
  }
  const sections = new Set<string>();
  for (const { key } of extension.sections ?? []) {
    if (!SECTION_KEY.test(key))
      throw new TypeError(`Section key ${JSON.stringify(key)} must match ${SECTION_KEY}`);
    if (key === INSTRUCTIONS_KEY)
      throw new Error(`Section key ${key} is reserved for the agent's instructions`);
    if (sections.has(key))
      throw new Error(`Extension ${extension.name} has two sections with key ${key}`);
    sections.add(key);
  }
}

function createRegistry<
  Tool extends typesModule.ToolRegistration = typesModule.ToolRegistration,
>(): typesModule.Registry<Tool> {
  return new RegistryImpl<Tool>();
}

const registry = {
  BUILTIN_TASKS: registryState.BUILTIN_TASKS,
  createRegistry,
};

export default registry;
