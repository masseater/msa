const loadMcpCommand = () => import("./cli.ts").then((module) => module.default);

const cliLazy = {
  loadMcpCommand,
};

export default cliLazy;
