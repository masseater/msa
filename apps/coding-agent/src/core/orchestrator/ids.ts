let counter = 0;

function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Math.floor(performance.timeOrigin).toString(36)}-${counter.toString(36)}`;
}

const ids = {
  newId,
};

export default ids;
