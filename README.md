# Organisational Voting Platform

A demo version of a platform used for organisational/society-specific voting and polling. After gathering and refining requirements through liasing with society committees, I managed to incorporate meeting management, member elections, motions, nominations, and live guest polls into this full stack application. The demo is hosted on the site and the login page allows you to use the demo admin account.

## Features

- Seperate administrator, officer, member, and guest permissions.
- Membership approval, attendance tracking, and voter eligibility snapshots when ballots open.
- Standard and ranked-choice elections, motions, candidate nomination through consent, and linked runoff or replacement ballots.
- Result publication, CSV exports, and ballot invalidation.
- Guest polling through meeting codes and QR links, plus live totals and a projector view.
- Transactional submissions, duplicate-request handling, and an administrative audit hash chain.


## User roles

| Role | Responsibilities |
| --- | --- |
| Administrator | Approves membership, manages account access and permissions and reviews audit history. |
| Officer | Manages meetings, attendance, nominations, ballots, polls, and result publication. |
| Member | Participates in nominations, casts eligible formal votes, and views published results. |
| Guest | Joins informal polls through a meeting code or QR link without an account. |

Administrator access, officer permissions, and approved membership are independent.

## Shared demo admin

The login page can show a **Use demo admin account** button. It fills the normal
sign-in form with a dedicated public demo login. Everyone using this account
shares its data and changes. There is no automatic reset of data.


## How it works

Officers prepare meetings and choose whether formal voting includes all approved members or only those marked present. Elections can use manually entered candidates or nominations (with nominee/officer approval).

Meetings move from planned to live to ended. They can be cancelled before voting begins and all open ballots and polls must close before a meeting can end.

When a formal ballot opens, its eligible voters and candidate options are fixed. Members review and confirm their votes, which can't be changed once they're submitted. Officers close the ballot before publishing results. Ranked-choice results show each counting round, and any unresolved tied can have a linked runoff election.

Closed ballots can't reopen. Invalidated ballots keep their records and can be linked to replacement ballots.

For informal polls, guests join by code or QR link and answer single/multiple choice questions. Results update live, with a projector view showing totals and instructions for joining.

## Account security

Passwords are hashed with Argon2 through `pwdlib`. Authentication uses server-side sessions with hashed tokens and HttpOnly cookies, with Secure cookies in production. Permissions are enforced by the backend.

Admins can suspend accounts and revoke sessions, as well as issue single-use password recovery codes that expire. Password resets revoke existing sessions. State-changing requests require CSRF checks. Also, Login/registration, recovery, and guest joining rate limited.

## Architecture

| Layer | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zod. |
| Backend | Python, FastAPI, Uvicorn, and Pydantic for request validation; organised into authentication, membership, meetings, nominations, ballots, audit, real-time modules. |
| Database | PostgreSQL with asynchronous SQLAlchemy, the `asyncpg` driver, Alembic migrations. |
| Testing and delivery | pytest, Vitest, Playwright, GitHub Actions, Docker. |

The frontend is held in in `apps/web` and the backend in `apps/api`. API endpoints handle application data and WebSocket notifications refresh poll views when necessary.

## Testing

Automated unit, PostgreSQL integration and browser tests cover voting workflows, concurrent submissions, transaction rollback, and access controls. GitHub Actions automates them, alongside linting/type-checking and the production frontend build.

## Voting integrity and privacy
Database transactions and locks prevent duplicate votes and handle submissions made while a ballot is closing. Guest duplicate prevention applies per session. Quorum requirements are not enforced.

Revision checks prevent outdated edits from overwriting newer changes. Idempotency keys prevent duplicate meetings or ballots when requests are retried. The interface warns about unsaved changes and requests whose outcome is uncertain.

Participation records are separate from vote choices. Votes are private within the app, but not cryptographically anonymous to server or database operators.

Admin actions are recorded in a hash-chained audit trail. Saved checkpoints help detect changes to that history (they do not verify vote counts).