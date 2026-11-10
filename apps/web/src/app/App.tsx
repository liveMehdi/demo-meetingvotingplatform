import { lazy, Suspense } from "react";
import { UnsavedChangesProvider } from "@/lib/UnsavedChanges";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Link,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { AppLayout, RequireAccount, RouteAnnouncer } from "./Layout";

const HealthPage = lazy(() =>
  import("@/pages/HealthPage").then((module) => ({
    default: module.HealthPage,
  })),
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("@/pages/ResetPasswordPage").then((module) => ({
    default: module.ResetPasswordPage,
  })),
);
const AccountPage = lazy(() =>
  import("@/pages/AccountPage").then((module) => ({
    default: module.AccountPage,
  })),
);
const RegisterPage = lazy(() =>
  import("@/pages/RegisterPage").then((module) => ({
    default: module.RegisterPage,
  })),
);
const MembersPage = lazy(() =>
  import("@/pages/MembersPage").then((module) => ({
    default: module.MembersPage,
  })),
);


const MeetingsPage = lazy(() =>
  import("@/pages/MeetingsPage").then((module) => ({
    default: module.MeetingsPage,
  })),
);

const MeetingPage = lazy(() =>
  import("@/pages/MeetingPage").then((module) => ({
    default: module.MeetingPage,
  })),
);
const MyBallotsPage = lazy(() =>
  import("@/pages/MyBallotsPage").then((module) => ({
    default: module.MyBallotsPage,
  })),
);
const VotePage = lazy(() =>
  import("@/pages/VotePage").then((module) => ({ default: module.VotePage })),
);
const AuditPage = lazy(() =>
  import("@/pages/AuditPage").then((module) => ({
    default: module.AuditPage,
  })),
);
const JoinPage = lazy(() =>
  import("@/pages/JoinPage").then((module) => ({ default: module.JoinPage })),
);
const GuestMeetingPage = lazy(() =>
  import("@/pages/GuestMeetingPage").then((module) => ({
    default: module.GuestMeetingPage,
  })),
);
const ProjectorPage = lazy(() =>
  import("@/pages/ProjectorPage").then((module) => ({
    default: module.ProjectorPage,
  })),
);
const NominationsPage = lazy(() =>
  import("@/pages/NominationsPage").then((module) => ({
    default: module.NominationsPage,
  })),
);

const HomePage = lazy(() =>
  import("@/pages/HomePage").then((module) => ({ default: module.HomePage })),
);

const queryClient = new QueryClient();

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      errorElement={
        <main className="page-shell page-narrow">
          <h1 className="page-title">This page could not be loaded</h1>
          <p className="page-intro">
            Check your connection, then reload. If you were creating something,
            check whether it saved before creating it again.
          </p>

          <button
            className="mt-6 ui-button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </main>
      }
      element={
        <UnsavedChangesProvider>
          <RouteAnnouncer />
          <Suspense
            fallback={
              <main className="page-shell supporting-copy" role="status">
                Loading page...
              </main>
            }
          >
            <Outlet />
          </Suspense>
        </UnsavedChangesProvider>
      }
    >
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/status" element={<HealthPage />} />
        <Route path="/register" element={<RegisterPage />} />
        
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAccount />}>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/meetings" element={<MeetingsPage />} />

          <Route path="/meetings/:meetingId" element={<MeetingPage />} />
          <Route path="/ballots" element={<MyBallotsPage />} />
          <Route path="/nominations" element={<NominationsPage />} />
          <Route path="/ballots/:ballotId" element={<VotePage />} />
        </Route>
        <Route
          path="*"
          element={
            <main className="page-shell page-narrow">
              <h1 className="page-title">Page not found</h1>
              <p className="page-intro">
                This address doesn't match a page in the app.
              </p>
              <Link to="/" className="mt-6 ui-button">
                Return home
              </Link>
            </main>
          }
        />
      </Route>
      <Route path="/join" element={<JoinPage />} />
      <Route path="/guest/meetings/:meetingId" element={<GuestMeetingPage />} />
      <Route
        path="/meetings/:meetingId/polls/:pollId/projector"
        element={<ProjectorPage />}
      />
    </Route>,
  ),
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
