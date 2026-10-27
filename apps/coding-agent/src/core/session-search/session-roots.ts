const within = (path: string, root: string): boolean =>
  path !== root && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`));

function sessionRoots(candidates: readonly (string | undefined)[]): string[] {
  const directories = [
    ...new Set(candidates.filter((path): path is string => path !== undefined && path !== "")),
  ];
  return directories.filter((path) => !directories.some((root) => within(path, root)));
}

const sessionRootsModule = { sessionRoots };

export default sessionRootsModule;
