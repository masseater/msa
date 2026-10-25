const ITEM = /^(?:[-*+]|\d+[.)])\s+/u;

function goalItems(goalState: string): string[] {
  const items: string[] = [];
  for (const line of goalState.split("\n")) {
    if (ITEM.test(line)) {
      items.push(line.replace(ITEM, "").trim());
      continue;
    }
    const last = items.length - 1;
    if (last >= 0 && line.trim() !== "") items[last] = `${items[last]}\n${line.trim()}`;
  }
  return items.length > 0 ? items : [goalState.trim()];
}

const goalItemsModule = { goalItems };

export default goalItemsModule;
