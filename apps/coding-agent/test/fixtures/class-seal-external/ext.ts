function External(): void {}

const kit = {
  Base: External as unknown as new () => object,
  register(name: "Base", value: new () => object): void {
    this[name] = value;
  },
};

const ext = {
  kit,
  subclassOf: (base: new () => object): new () => object => class Sub extends base {},
};

export default ext;
