# Server API boundary

`api/` contains server-only Vercel Node functions. Browser code must not import from this directory.

Current routes:

- `GET /api/health` — unauthenticated liveness check. It returns only safe environment metadata and a request ID; it does not prove database, auth, billing, or inference readiness.
- `/api/auth/*` — Better Auth email/password session endpoints with required email verification and password recovery. They require `DATABASE_URL`, `AUTH_SECRET`, `APP_ORIGIN`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- `GET /api/me` — returns a deliberately limited authenticated-user DTO or `401`; identity is derived from the secure session cookie, never from a request body.

Run `pnpm db:migrate` with a direct/admin Neon connection string before using authentication. Runtime requests should use Neon’s pooled connection string. Resend is called only from the server for verification/recovery email delivery.

Future protected routes must derive identity from a secure session, validate request bodies, enforce ownership, and keep provider/payment credentials server-side. Do not add direct provider calls to frontend code as a shortcut.
