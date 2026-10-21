const loadCodemodeExecutor = () => import("./execute.ts").then((module) => module.default);

const executeLazy = {
  loadCodemodeExecutor,
};

export default executeLazy;
