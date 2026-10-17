export function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

export function withEnvVars(vars: Record<string, string | undefined>, fn: () => void): void {
  const entries = Object.entries(vars);
  const run = (index: number): void => {
    if (index >= entries.length) {
      fn();
      return;
    }
    const [name, value] = entries[index]!;
    withEnv(name, value, () => run(index + 1));
  };
  run(0);
}
