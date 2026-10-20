import type extensionsTypesTypes from "../extensions/types.types.ts";

const detectExtensionConflicts = (
  extensions: extensionsTypesTypes.Extension[],
): Array<{ path: string; message: string }> => {
  const conflicts: Array<{ path: string; message: string }> = [];

  const toolOwners = new Map<string, string>();
  const flagOwners = new Map<string, string>();

  for (const ext of extensions) {
    for (const toolName of ext.tools.keys()) {
      const existingOwner = toolOwners.get(toolName);
      if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
        conflicts.push({
          message: `Tool "${toolName}" conflicts with ${existingOwner}`,
          path: ext.path,
        });
      } else {
        toolOwners.set(toolName, ext.path);
      }
    }

    for (const flagName of ext.flags.keys()) {
      const existingOwner = flagOwners.get(flagName);
      if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
        conflicts.push({
          message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
          path: ext.path,
        });
      } else {
        flagOwners.set(flagName, ext.path);
      }
    }
  }

  return conflicts;
};

const addExtensionConflictDiagnostics = (
  extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
): void => {
  const conflicts = detectExtensionConflicts(extensionsResult.extensions);
  for (const conflict of conflicts) {
    extensionsResult.errors.push({ error: conflict.message, path: conflict.path });
  }
};

export default addExtensionConflictDiagnostics;
