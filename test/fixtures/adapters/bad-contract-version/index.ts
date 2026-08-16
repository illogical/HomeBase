export const effects: string[] = [];

const createBadContractVersionFixture = () => ({
  contractVersion: 2,
  async initialize() {
    effects.push("initialize");
  },
  async getStatus() {
    return { state: "ready", summary: "unreachable", since: new Date().toISOString() };
  },
});

export default createBadContractVersionFixture;
