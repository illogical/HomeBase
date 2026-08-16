import { useEffect, useState } from "react";
import type { DashboardApplication, DashboardDataSource } from "./models";

interface ApplicationLoadState {
  readonly applications: readonly DashboardApplication[] | null;
  readonly error: boolean;
}

export function useApplications(dataSource: DashboardDataSource): ApplicationLoadState {
  const [state, setState] = useState<ApplicationLoadState>({
    applications: null,
    error: false,
  });

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
  }, [dataSource]);

  return state;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
