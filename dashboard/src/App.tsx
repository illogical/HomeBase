import { useRef, type MouseEvent } from "react";
import type { ApplicationViewState, DashboardApplication, DashboardDataSource } from "./models";
import { useApplications } from "./useApplications";

export interface AppProps {
  readonly dataSource: DashboardDataSource;
}

const stateLabels: Readonly<Record<ApplicationViewState, string>> = {
  disabled: "Disabled",
  loading: "Loading",
  initializing: "Initializing",
  ready: "Ready",
  degraded: "Degraded",
  unavailable: "Unavailable",
  stopping: "Stopping",
};

export function App({ dataSource }: AppProps) {
  const mainRef = useRef<HTMLElement>(null);
  const { applications, error } = useApplications(dataSource);

  const focusMain = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    mainRef.current?.focus();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#applications`,
    );
  };

  return (
    <>
      <a className="skip-link" href="#applications" onClick={focusMain}>
        Skip to applications
      </a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-mark" aria-hidden="true">HB</div>
          <div>
            <div className="wordmark">HomeBase</div>
            <div className="portal-label">Application portal</div>
          </div>
        </div>
      </header>
      <main id="applications" ref={mainRef} tabIndex={-1}>
        <ApplicationCollection applications={applications} error={error} />
      </main>
    </>
  );
}

interface ApplicationCollectionProps {
  readonly applications: readonly DashboardApplication[] | null;
  readonly error: boolean;
}

function ApplicationCollection({ applications, error }: ApplicationCollectionProps) {
  if (applications === null) {
    return <LoadingApplications />;
  }

  if (applications.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-mark" aria-hidden="true">HB</div>
        <h2 id="empty-title">{error ? "Sample applications could not be loaded" : "No sample applications"}</h2>
        <p>
          {error
            ? "The prototype data source did not return an application list."
            : "This fixture intentionally shows how HomeBase looks before applications are listed."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="collection-title">
      <div className="collection-heading">
        <h2 id="collection-title">Applications</h2>
        <p>{applications.length} sample applications</p>
      </div>
      <ul className="application-grid">
        {applications.map((application) => (
          <li key={application.id}>
            <ApplicationCard application={application} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApplicationCard({ application }: { readonly application: DashboardApplication }) {
  const monogram = application.displayName.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return (
    <article className={`application-card state-${application.state}`}>
      <div className="card-heading">
        <div className="app-monogram" aria-hidden="true">{monogram}</div>
        <span className="status-badge">
          <span className="status-dot" aria-hidden="true" />
          {stateLabels[application.state]}
        </span>
      </div>
      <div className="card-copy">
        <h3>{application.displayName}</h3>
        <p className="description">{application.description}</p>
      </div>
      <div className="card-status">
        <p>{application.statusSummary}</p>
        <code>{application.basePath}</code>
      </div>
    </article>
  );
}

function LoadingApplications() {
  return (
    <section aria-labelledby="loading-title" aria-busy="true">
      <div className="collection-heading">
        <h2 id="loading-title">Applications</h2>
        <p role="status" aria-live="polite">Loading sample applications.</p>
      </div>
      <ul className="application-grid skeleton-grid" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <li key={item}>
            <div className="application-card skeleton-card">
              <span className="skeleton-block skeleton-icon" />
              <span className="skeleton-block skeleton-title" />
              <span className="skeleton-block skeleton-copy" />
              <span className="skeleton-block skeleton-route" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
