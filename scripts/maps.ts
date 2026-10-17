import { Function } from "effect";

const getOrCreate: {
  <K, V>(key: K, create: () => V): (map: Map<K, V>) => V;
  <K, V>(map: Map<K, V>, key: K, create: () => V): V;
} = Function.dual(3, <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
});

export { getOrCreate };
