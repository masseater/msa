import type keybindingDefinitionsTypes from "./keybinding-definitions.types.ts";
import type keybindingsTypes from "./keybindings.types.ts";
import keysModule from "./keys.ts";
import type keysTypes from "./keys.types.ts";

const { matchesKey } = keysModule;

function normalizeKeys(keys: keysTypes.KeyId | keysTypes.KeyId[] | undefined): keysTypes.KeyId[] {
  if (keys === undefined) return [];
  const keyList = Array.isArray(keys) ? keys : [keys];
  const seen = new Set<keysTypes.KeyId>();
  const result: keysTypes.KeyId[] = [];
  for (const key of keyList) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

export default class KeybindingsManager {
  private definitions: keybindingDefinitionsTypes.KeybindingDefinitions;
  private userBindings: keybindingDefinitionsTypes.KeybindingsConfig;
  private keysById = new Map<keybindingDefinitionsTypes.Keybinding, keysTypes.KeyId[]>();
  private conflicts: keybindingsTypes.KeybindingConflict[] = [];

  constructor(
    definitions: keybindingDefinitionsTypes.KeybindingDefinitions,
    userBindings: keybindingDefinitionsTypes.KeybindingsConfig = {},
  ) {
    this.definitions = definitions;
    this.userBindings = userBindings;
    this.rebuild();
  }

  private rebuild(): void {
    this.keysById.clear();
    this.conflicts = [];

    const userClaims = new Map<keysTypes.KeyId, Set<keybindingDefinitionsTypes.Keybinding>>();
    for (const [keybinding, keys] of Object.entries(this.userBindings)) {
      if (!(keybinding in this.definitions)) continue;
      for (const key of normalizeKeys(keys)) {
        const claimants = userClaims.get(key) ?? new Set<keybindingDefinitionsTypes.Keybinding>();
        claimants.add(keybinding as keybindingDefinitionsTypes.Keybinding);
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
      this.keysById.set(id as keybindingDefinitionsTypes.Keybinding, keys);
    }
  }

  matches(data: string, keybinding: keybindingDefinitionsTypes.Keybinding): boolean {
    const keys = this.keysById.get(keybinding) ?? [];
    for (const key of keys) {
      if (matchesKey(data, key)) return true;
    }
    return false;
  }

  getKeys(keybinding: keybindingDefinitionsTypes.Keybinding): keysTypes.KeyId[] {
    return [...(this.keysById.get(keybinding) ?? [])];
  }

  getDefinition(
    keybinding: keybindingDefinitionsTypes.Keybinding,
  ): keybindingDefinitionsTypes.KeybindingDefinition | undefined {
    return this.definitions[keybinding];
  }

  getConflicts(): keybindingsTypes.KeybindingConflict[] {
    return this.conflicts.map((conflict) => ({
      ...conflict,
      keybindings: [...conflict.keybindings],
    }));
  }

  setUserBindings(userBindings: keybindingDefinitionsTypes.KeybindingsConfig): void {
    this.userBindings = userBindings;
    this.rebuild();
  }

  getUserBindings(): keybindingDefinitionsTypes.KeybindingsConfig {
    return { ...this.userBindings };
  }

  getResolvedBindings(): keybindingDefinitionsTypes.KeybindingsConfig {
    const resolved: keybindingDefinitionsTypes.KeybindingsConfig = {};
    for (const id of Object.keys(this.definitions)) {
      const keys = this.keysById.get(id as keybindingDefinitionsTypes.Keybinding) ?? [];
      resolved[id] = keys.length === 1 ? keys[0]! : [...keys];
    }
    return resolved;
  }
}
