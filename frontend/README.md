# Frontend — Next.js

The UI is a Next.js App Router application. It contains browser UI and API communication only; it does not implement authentication, persistence, OAuth provider logic, or other backend behavior.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local` and set `BACKEND_URL` to the Spring API origin.
3. Install packages with `npm install`.
4. Start the UI with `npm run dev` and open `http://localhost:3000`.

Next.js rewrites `/api/*` and OAuth routes to `BACKEND_URL`, keeping browser requests on the frontend origin. The backend must allow the frontend callback URL for same-tab OAuth handoff. Production must use HTTPS.

Access JWTs stay in memory. The refresh cookie is managed by the browser. On logout, send the current access JWT in `Authorization: Bearer`, include browser credentials for the refresh cookie, and copy `XSRF-TOKEN` into `X-CSRF-TOKEN`. After successful logout, clear the in-memory JWT. Only acknowledged mock product additions and hidden product IDs are stored in `localStorage`.
