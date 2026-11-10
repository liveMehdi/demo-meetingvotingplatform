import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getHealth, getReadiness } from "@/lib/health";

export function HealthPage() {
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: async ({ signal }) => {
      await getReadiness(signal);
      return true;
    },
    retry: false,
    refetchOnWindowFocus: false,
    networkMode: "always",
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
    refetchOnWindowFocus: false,
    networkMode: "always",
  });

  return (
    <main className="page-shell page-narrow">
      <header className="mb-8">
        <h1 className="page-title">Service status</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>App connection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4" aria-live="polite" aria-atomic="true">
            {health.isPending ? (
              <p role="status" className="text-muted-foreground">
                Checking connection…
              </p>
            ) : health.isError ? (
              <div role="alert">
                <p className="font-medium text-destructive">
                  Connection unavailable. Try again.
                </p>
                <details className="mt-2 supporting-copy">
                  <summary className="w-fit cursor-pointer">
                    Diagnostic details
                  </summary>
                  <p className="mt-2">{health.error.message}</p>
                </details>
              </div>
            ) : (
              <div role="status">
                <p className="font-medium text-emerald-300">Connected</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
            className="ui-button ui-button-primary"
          >
            {health.isFetching
              ? "Checking…"
              : health.isError
                ? "Try again"
                : "Check again"}
          </button>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Database</CardTitle>
        </CardHeader>
        <CardContent>
          {readiness.isPending ? (
            <p role="status">Checking database…</p>
          ) : readiness.isError ? (
            <p role="alert" className="text-destructive">
              Database not ready. Contact the administrator if this continues.
            </p>
          ) : (
            <p role="status" className="text-emerald-300">
              Ready
            </p>
          )}
          <details className="mt-3 supporting-copy">
            <summary className="w-fit cursor-pointer">
              Diagnostic details
            </summary>
            <p className="mt-2">
              Checks database connectivity and migration version, not the
              contents of stored records.
            </p>
            {readiness.isError && (
              <p className="mt-2">{readiness.error.message}</p>
            )}
          </details>
          <button
            className="mt-4 ui-button"
            disabled={readiness.isFetching}
            onClick={() => void readiness.refetch()}
          >
            Check again
          </button>
        </CardContent>
      </Card>
      <nav
        aria-label="Continue from service status"
        className="mt-6 action-row"
      >
        <Link to="/register" className="back-link">
          Create an account
        </Link>
        <Link to="/join" className="back-link">
          Join as a guest
        </Link>
        <Link to="/account" className="back-link">
          My account / sign in
        </Link>
      </nav>
    </main>
  );
}
