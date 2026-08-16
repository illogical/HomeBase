import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];

interface FakeSocket {
  closed: boolean;
  close(): void;
}

const createCleanupFixture: CreateHostedApplication = (options) => {
  let interval: ReturnType<typeof setInterval> | undefined;
  let socket: FakeSocket | undefined;
  let disposed = false;
  const tag = (event: string): string => `${options.applicationId}:${event}`;

  return {
    contractVersion: HOSTED_CONTRACT_VERSION,
    async initialize() {
      interval = setInterval(() => {
        effects.push(tag("tick"));
      }, 1000);
      socket = {
        closed: false,
        close() {
          this.closed = true;
        },
      };
      effects.push(tag("initialize"));
    },
    async getStatus() {
      return { state: "ready", summary: "Cleanup fixture ready.", since: new Date().toISOString() };
    },
    async dispose() {
      if (disposed) {
        effects.push(tag("dispose-noop"));
        return;
      }
      disposed = true;
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      socket?.close();
      effects.push(tag("dispose"));
    },
  };
};

export default createCleanupFixture;
