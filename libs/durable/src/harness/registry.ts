import { INSTRUCTIONS_KEY } from "./agent.ts";
import { RegistryState } from "./registry-state.ts";
import type { Extension, Registry, RegistrySnapshot, ToolRegistration } from "./types.ts";

export { BUILTIN_TASKS } from "./registry-state.ts";

const SECTION_KEY = /^[a-z][a-z0-9_-]*$/u;

class RegistryImpl<Tool extends ToolRegistration> implements Registry<Tool> {
  #current = new RegistryState<Tool>([]);
  readonly #listeners = new Set<() => void>();

  snapshot(): RegistrySnapshot<Tool> {
    return this.#current;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  install(extension: Extension<Tool>): void {
    validateExtension(extension);
    const current = this.#current.installed();
    const index = current.findIndex((installed) => installed.name === extension.name);
    const next =
      index < 0
        ? [...current, extension]
        : current.map((installed, at) => (at === index ? extension : installed));
    this.#publish(next);
  }

  uninstall(extension: Extension): void {
    const current = this.#current.installed();
    if (!current.some((installed) => installed.name === extension.name)) return;
    this.#publish(current.filter((installed) => installed.name !== extension.name));
  }

  #publish(extensions: readonly Extension<Tool>[]): void {
    this.#current = new RegistryState(extensions);
    for (const listener of [...this.#listeners]) listener();
  }
}

function validateExtension(extension: Extension): void {
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

export function createRegistry<Tool extends ToolRegistration = ToolRegistration>(): Registry<Tool> {
  return new RegistryImpl<Tool>();
}
