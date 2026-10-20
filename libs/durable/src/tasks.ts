import type typesModule from "./types.types.ts";

function defineTask<I, S extends { phase: string }, R, H extends object = object>(
  definition: typesModule.TaskDefinition<I, S, R, H>,
): typesModule.Task<I, S, R, H> {
  return { definition };
}

const tasks = {
  defineTask,
};

export default tasks;
