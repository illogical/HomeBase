import { useCallback, useEffect, useState } from "react";
import type { DashboardApplication, DashboardDataSource } from "./models";

interface ApplicationLoadState {
  readonly applications: readonly DashboardApplication[] | null;
  readonly error: boolean;
  readonly retry: () => void;
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

    setState({ applications: null, error: false });
    void dataSource.listApplications(controller.signal).then(
      (applications) => {
        if (active) {
          setState({ applications, error: false });
        }
      },
      (error: unknown) => {
        if (active && !isAbortError(error)) {
          setState({ applications: Object.freeze([]), error: true });
        }
      },
    );

    return () => {
      active = false;
      controller.abort();
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
