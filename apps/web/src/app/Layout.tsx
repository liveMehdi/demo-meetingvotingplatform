import { useUnsavedNavigation } from "@/lib/UnsavedChanges";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";
import { currentUserKey, logoutAccount } from "@/features/auth/api";
import { useAccount } from "@/features/auth/use-account";
import { loginUrl } from "@/lib/navigation";

export function RequireAccount() {
  const account = useAccount();
  const location = useLocation();
  if (account.isPending)
    return (
      <main className="page-shell">
        <p role="status" className="supporting-copy">
          Checking your session...
        </p>
      </main>
    );
  if (account.isError && !account.data)
    return (
      <main className="page-shell">
        <p role="alert">We could not check your session.</p>
        <button
          className="mt-4 ui-button"
          onClick={() => void account.refetch()}
        >
          Try again
        </button>
      </main>
    );
  if (!account.data)
    return (
      <Navigate to={loginUrl(location.pathname + location.search)} replace />
    );
  return <Outlet />;
}

export function AppLayout() {
  const unsaved = useUnsavedNavigation();
  const account = useAccount();
  const user = account.isSuccess ? account.data : null;
  const client = useQueryClient();
  const navigate = useNavigate();

  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const logout = useMutation({
    mutationFn: logoutAccount,
    retry: false,
    networkMode: "always",
    async onSuccess() {
      
      unsaved.clear();
      await client.cancelQueries();
      client.clear();
      client.setQueryData(currentUserKey, null);
      navigate("/login", { replace: true });
    },
    onError() {
      void client.invalidateQueries({ queryKey: currentUserKey });
    },
  });
  useEffect(() => {
    setMenuOpen(false);
    if (accountMenu.current) accountMenu.current.open = false;
  }, [location.pathname, location.search]);
  const links = [
    { to: "/", label: "Home", end: true },
    ...(user
      ? [
          { to: "/ballots", label: "Your ballots", end: false },
          { to: "/nominations", label: "Nominations", end: false },
          ...(user.is_officer
            ? [{ to: "/meetings", label: "Manage meetings", end: false }]
            : []),
          ...(user.is_admin
            ? [
                { to: "/members", label: "Members", end: false },
                { to: "/audit", label: "Activity", end: false },
              ]
            : []),
        ]
      : [{ to: "/join", label: "Join with a code", end: false }]),
  ];
  return (
    <>
      <a
        href="#page-content"
        className="sr-only focus:not-sr-only focus:block focus:p-4"
      >
        Skip to content
      </a>
      <header className="bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6 xl:flex-nowrap">
          <Link
            to="/"
            aria-label="Elections Portal home"
            className="flex items-center gap-3 font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m7 5 3 3 6-6M5 11h14v10H5zM9 15h6" />
              </svg>
            </span>
            <span className="text-lg font-medium">
              Elections<span className="hidden sm:inline"> Portal</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-3 xl:order-3">
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="app-navigation"
              className="ui-button lg:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              Menu
            </button>
            {user ? (
              <details ref={accountMenu} className="relative">
                <summary className="cursor-pointer rounded-full bg-card px-5 py-3 text-sm text-foreground hover:bg-surface">
                  Account
                </summary>
                <div className="absolute right-0 z-20 mt-3 w-64 surface-panel shadow-xl shadow-black/30">
                  <p className="break-words supporting-copy">{user.email}</p>
                  <Link to="/account" className="mt-3 block underline">
                    Membership and account
                  </Link>
                  <button
                    type="button"
                    className="mt-4 ui-button"
                    disabled={logout.isPending}
                    onClick={() => {
                      if (unsaved.confirmLeave()) logout.mutate();
                    }}
                  >
                    {logout.isPending ? "Signing out..." : "Sign out"}
                  </button>
                  {logout.isError && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {logout.error.message}
                    </p>
                  )}
                </div>
              </details>
            ) : (
              <Link
                className="ui-button"
                to={loginUrl(location.pathname + location.search)}
              >
                Sign in
              </Link>
            )}
          </div>
          <nav
            id="app-navigation"
            aria-label="Main navigation"
            className={`${menuOpen ? "flex" : "hidden"} segmented-track w-full flex-wrap lg:flex lg:w-fit xl:order-2`}
          >
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className="segmented-item"
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <div id="page-content" tabIndex={-1} className="min-h-[70svh]">
        <Outlet />
      </div>
      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground">
        <span>
          Elections Portal Demo <span aria-hidden="true">·</span> Member voting &amp;
          live polls
        </span>
        <Link to="/status" className="hover:text-foreground">
          Service status
        </Link>
      </footer>
    </>
  );
}

export function RouteAnnouncer() {
  const { pathname } = useLocation();
  useEffect(() => {
    const section = pathname.split("/")[1];
    const titles: Record<string, string> = {
      "": "Home",
      login: "Sign in",
      register: "Create account",
      account: "Your account",
      members: "Members and officers",
      audit: "Administrative activity",
      ballots: "Your ballots",
      nominations: "Nominations",
      meetings: "Meetings",
      join: "Join a meeting",
      guest: "Guest polls",
      status: "Service status",
    };
    document.title = `${pathname.endsWith("/projector") ? "Poll projector" : (titles[section] ?? "Page not found")} | Elections Portal`;
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector("main");
      if (main) {
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  return null;
}
