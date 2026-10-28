const extend = {
  subclass: (base: new () => object): new () => object => class Inner extends base {},
};

export default extend;
