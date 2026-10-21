class EsbuildFilter extends RegExp {
  override get flags(): string {
    return "";
  }
}

const esbuildFilter = {
  EsbuildFilter,
};

export default esbuildFilter;
