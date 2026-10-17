export class SetMap<K, V> extends Map<K, Set<V>> {
  addTo(key: K, value: V): void {
    const values = this.get(key);
    if (values === undefined) this.set(key, new Set([value]));
    else values.add(value);
  }

  deleteFrom(key: K, value: V): void {
    const values = this.get(key);
    if (values === undefined) return;
    values.delete(value);
    if (values.size === 0) this.delete(key);
  }
}
