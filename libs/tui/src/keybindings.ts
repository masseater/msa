import {
  type Keybinding,
  type KeybindingDefinition,
  type KeybindingDefinitions,
  type KeybindingsConfig,
  TUI_KEYBINDINGS,
} from "./keybinding-definitions.ts";
import { type KeyId, matchesKey } from "./keys.ts";

export interface KeybindingConflict {
  key: KeyId;
  keybindings: string[];
}

function normalizeKeys(keys: KeyId | KeyId[] | undefined): KeyId[] {
  if (keys === undefined) return [];
  const keyList = Array.isArray(keys) ? keys : [keys];
  const seen = new Set<KeyId>();
  const result: KeyId[] = [];
  for (const key of keyList) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

export class KeybindingsManager {
  private definitions: KeybindingDefinitions;
  private userBindings: KeybindingsConfig;
  private keysById = new Map<Keybinding, KeyId[]>();
  private conflicts: KeybindingConflict[] = [];

  constructor(definitions: KeybindingDefinitions, userBindings: KeybindingsConfig = {}) {
    this.definitions = definitions;
    this.userBindings = userBindings;
    this.rebuild();
  }

  private rebuild(): void {
    this.keysById.clear();
    this.conflicts = [];

    const userClaims = new Map<KeyId, Set<Keybinding>>();
    for (const [keybinding, keys] of Object.entries(this.userBindings)) {
      if (!(keybinding in this.definitions)) continue;
      for (const key of normalizeKeys(keys)) {
        const claimants = userClaims.get(key) ?? new Set<Keybinding>();
        claimants.add(keybinding as Keybinding);
        userClaims.set(key, claimants);
      }
    }

    for (const [key, keybindings] of userClaims) {
      if (keybindings.size > 1) {
        this.conflicts.push({ key, keybindings: [...keybindings] });
      }
    }

    for (const [id, definition] of Object.entries(this.definitions)) {
      const userKeys = this.userBindings[id];
      const keys =
        userKeys === undefined ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
      this.keysById.set(id as Keybinding, keys);
    }
  }

  matches(data: string, keybinding: Keybinding): boolean {
    const keys = this.keysById.get(keybinding) ?? [];
    for (const key of keys) {
      if (matchesKey(data, key)) return true;
    }
    return false;
  }

  getKeys(keybinding: Keybinding): KeyId[] {
    return [...(this.keysById.get(keybinding) ?? [])];
  }

  getDefinition(keybinding: Keybinding): KeybindingDefinition | undefined {
    return this.definitions[keybinding];
  }

  getConflicts(): KeybindingConflict[] {
    return this.conflicts.map((conflict) => ({
      ...conflict,
      keybindings: [...conflict.keybindings],
    }));
  }

  setUserBindings(userBindings: KeybindingsConfig): void {
    this.userBindings = userBindings;
    this.rebuild();
  }

  getUserBindings(): KeybindingsConfig {
    return { ...this.userBindings };
  }

  getResolvedBindings(): KeybindingsConfig {
    const resolved: KeybindingsConfig = {};
    for (const id of Object.keys(this.definitions)) {
      const keys = this.keysById.get(id as Keybinding) ?? [];
      resolved[id] = keys.length === 1 ? keys[0]! : [...keys];
    }
    return resolved;
  }
}

let globalKeybindings: KeybindingsManager | null = null;

export function setKeybindings(keybindings: KeybindingsManager): void {
  globalKeybindings = keybindings;
}

export function getKeybindings(): KeybindingsManager {
  if (globalKeybindings === null) {
    globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  }
  return globalKeybindings;
}
