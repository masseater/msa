import type scopedModelsSelectorInternalTypes from "./scoped-models-selector-internal.types.ts";

function isEnabled(enabledIds: scopedModelsSelectorInternalTypes.EnabledIds, id: string): boolean {
  return enabledIds === null || enabledIds.includes(id);
}

function normalizeEnabled(
  result: string[],
  allIds: string[],
): scopedModelsSelectorInternalTypes.EnabledIds {
  return result.length === allIds.length && result.every((id) => allIds.includes(id))
    ? null
    : result;
}

function toggle(
  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds,
  allIds: string[],
  id: string,
): scopedModelsSelectorInternalTypes.EnabledIds {
  if (enabledIds === null) return allIds.filter((modelId) => modelId !== id);
  const index = enabledIds.indexOf(id);
  if (index >= 0) return [...enabledIds.slice(0, index), ...enabledIds.slice(index + 1)];
  return normalizeEnabled([...enabledIds, id], allIds);
}

function enableAll(
  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds,
  allIds: string[],
  targetIds?: string[],
): scopedModelsSelectorInternalTypes.EnabledIds {
  if (enabledIds === null) return null;
  const targets = targetIds ?? allIds;
  const result = [...enabledIds];
  for (const id of targets) {
    if (!result.includes(id)) result.push(id);
  }
  return normalizeEnabled(result, allIds);
}

function clearAll(
  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds,
  allIds: string[],
  targetIds?: string[],
): scopedModelsSelectorInternalTypes.EnabledIds {
  if (enabledIds === null) {
    return targetIds === undefined ? [] : allIds.filter((id) => !targetIds.includes(id));
  }
  const targets = new Set(targetIds ?? enabledIds);
  return enabledIds.filter((id) => !targets.has(id));
}

function move(
  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds,
  id: string,
  delta: number,
): scopedModelsSelectorInternalTypes.EnabledIds {
  if (enabledIds === null) return null;
  const list = [...enabledIds];
  const index = list.indexOf(id);
  if (index < 0) return list;
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= list.length) return list;
  const moved = list[index];
  const displaced = list[newIndex];
  if (moved === undefined || displaced === undefined) return list;
  const result = [...list];
  result[index] = displaced;
  result[newIndex] = moved;
  return result;
}

function getSortedIds(
  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds,
  allIds: string[],
): string[] {
  if (enabledIds === null) return allIds;
  const enabledSet = new Set(enabledIds);
  return [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
}

const scopedModelsSelectorHelpers = {
  clearAll,
  enableAll,
  getSortedIds,
  isEnabled,
  move,
  normalizeEnabled,
  toggle,
};

export default scopedModelsSelectorHelpers;
