type BuiltinLookup = (id: string) => unknown;

function isSea(): boolean {
  const lookup = Reflect.get(process, "getBuiltinModule") as BuiltinLookup | undefined;
  const sea = lookup?.call(process, "node:sea") as { isSea(): boolean } | undefined;
  return sea?.isSea() === true;
}

const nodeSea = { isSea };

export default nodeSea;
