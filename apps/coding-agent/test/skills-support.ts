import testing from "@msa/testing";

const { resolvePath } = testing;

const fixturesDir = resolvePath(__dirname, "fixtures/skills");

const skillsSupport = {
  fixturesDir,
};

export default skillsSupport;
