import { useCallback, useEffect, useState } from "react";
import type { DashboardApplication, DashboardDataSource } from "./models";

interface ApplicationLoadState {
  readonly applications: readonly DashboardApplication[] | null;
  readonly error: boolean;
  readonly retry: () => void;
}

const POLL_INTERVAL_MS = 2000;

function hasNonTerminalApplication(applications: readonly DashboardApplication[] | null): boolean {
  if (applications === null) return false;
  return applications.some(
    (application) => application.state === "loading" || application.state === "initializing",
  );
}

export function useApplications(dataSource: DashboardDataSource): ApplicationLoadState {
  const [state, setState] = useState<{
    readonly applications: readonly DashboardApplication[] | null;
    readonly error: boolean;
  }>({
    applications: null,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const load = (): void => {
      void dataSource.listApplications(controller.signal).then(
        (applications) => {
          if (!active) return;
          setState({ applications, error: false });
          if (hasNonTerminalApplication(applications)) {
            pollTimer = setTimeout(load, POLL_INTERVAL_MS);
          }
        },
        (error: unknown) => {
          if (active && !isAbortError(error)) {
            setState({ applications: Object.freeze([]), error: true });
          }
        },
      );
    };

    setState({ applications: null, error: false });
    load();

    return () => {
      active = false;
      controller.abort();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
    };
  }, [dataSource, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { ...state, retry };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
