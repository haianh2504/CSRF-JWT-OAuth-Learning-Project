# Frontend — Next.js

The UI is a Next.js App Router application. It contains browser UI and API communication only; it does not implement authentication, persistence, OAuth provider logic, or other backend behavior.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local` and set `BACKEND_URL` to the Spring API origin.
3. Install packages with `npm install`.
4. Start the UI with `npm run dev` and open `http://localhost:3000`.

Next.js rewrites `/api/*` and OAuth routes to `BACKEND_URL`, keeping browser requests on the frontend origin. The backend must allow the exact frontend popup callback URL. OAuth opens a popup from the user gesture; its callback removes the handoff code from the URL and posts only that code to the opener using exact-origin `postMessage`. The opener validates the popup origin/source, exchanges the code through the proxy, acknowledges receipt, and then the popup closes. The proxy must forward `Cookie` upstream and preserve `Set-Cookie`. Production must use HTTPS.

Access JWTs stay in memory. The refresh cookie is managed by the browser. Each session family expires 15 days after login; refresh tokens have up to 7 days idle lifetime, cannot extend the family, and access JWT expiry is capped at the family end. If the access JWT has expired when the user logs out, silently refresh it first; keep the same session `sid` and do not interrupt the UI. Then send the access JWT in `Authorization: Bearer`, include browser credentials for the refresh cookie, and copy the CSRF value from `XSRF-TOKEN` into `X-CSRF-TOKEN`. The backend stores its hash in local Redis by `sid`; the CSRF value is not signed. After successful logout, clear the in-memory JWT. Only acknowledged mock product additions and hidden product IDs are stored in `localStorage`.
