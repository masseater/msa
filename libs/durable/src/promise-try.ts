const promiseTry = <T>(run: () => T | PromiseLike<T>): Promise<T> => {
  try {
    const value = run();
    return Promise.resolve().then(() => value);
  } catch (error) {
    return Promise.reject(error);
  }
};

const promiseTryModule = {
  promiseTry,
};

export default promiseTryModule;
