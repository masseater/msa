const deeplyFrozen = new WeakSet<object>();

function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object" || deeplyFrozen.has(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
  deeplyFrozen.add(value);
  return value;
}

const contextFreeze = {
  freezeJson,
};

export default contextFreeze;
