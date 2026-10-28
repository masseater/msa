const loadMemoryCli = () => import("./memory-cli.ts").then((module) => module.default);

const memoryCliLazy = {
  loadMemoryCli,
};

export default memoryCliLazy;
