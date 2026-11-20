# Server API boundary

`api/` contains server-only Vercel Node functions. Browser code must not import from this directory.

Current route:

- `GET /api/health` — unauthenticated liveness check. It returns only safe environment metadata and a request ID; it does not prove database, auth, billing, or inference readiness.

Future protected routes must derive identity from a secure session, validate request bodies, enforce ownership, and keep provider/payment credentials server-side. Do not add direct provider calls to frontend code as a shortcut.
