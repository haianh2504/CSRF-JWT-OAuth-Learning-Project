# UI Workflow and API Map

## Scope and sources

This document maps the current Next.js frontend to the confirmed behavior in `PRD.md`, `use_case.md`, `api_contract.md`, and the existing prototype (`index.html`). The Next.js app is the product implementation; the prototype is a visual reference only. Frontend route and API endpoint are distinct: the current UI uses `/` and calls documented API endpoints through the Next.js proxy.

The approved visual direction is light, for learners around ages 17–26. Keep authentication secrets out of browser storage and request-inspector output. Access JWT stays in JavaScript memory; the refresh token remains an HttpOnly cookie. Only acknowledged mock-product state is stored locally.

## Workflow to API to UI

| Flow | Documented API | Current UI entry and result | Implemented UI behavior / remaining limit |
|---|---|---|---|
| Sign up (UC-01) | `POST /api/v1/auth/signup` with email/password | Auth form switches to sign-in after success; clears the password after submission. | Pending state disables repeat submit; validation/API errors stay beside the form. |
| Sign in (UC-02) | `POST /api/v1/auth/signin`; response returns access JWT and sets refresh/CSRF cookies | Auth form establishes in-memory session, then loads shop data. | Pending/loading states are visible; if shop loading fails after sign-in, the form offers retry without asking for credentials again. |
| Google/Facebook OAuth (UC-03/04) | Browser redirect to `/oauth2/authorization/{provider}`; backend callback returns one-time app handoff code | OAuth buttons start same-tab redirect; `/` removes callback query before exchanging the code. | Callback shows progress and an accessible recoverable error; one exchange is attempted. No app JWT belongs in a URL. |
| OAuth handoff (UC-05) | `POST /api/v1/auth/oauth/exchange` with `{ code }` | Exchange result follows the same session setup path as sign-in. | Progress remains visible through exchange/shop load; the code is removed from browser history before the request. |
| Restore/refresh session (UC-10) | `POST /api/v1/auth/refresh` with refresh cookie and `X-CSRF-TOKEN` copied from `XSRF-TOKEN` | On initial load, refresh is attempted when the CSRF cookie exists; concurrent refresh calls share one promise. | Initial restore shows progress, refresh calls are serialized, and expired sessions return to sign-in with a safe message. Cookie values are not exposed in UI/logs. |
| Load shop/catalog (UC-06) | `GET /api/v1/homepage` and `GET /api/v1/products`, both Bearer-authenticated | Shop renders account/shop summary and merged catalog; hidden IDs filter products locally. | Loading, retryable error, and empty states are distinct. Browser-local additions/hides are labeled as such. |
| Add product (UC-07) | `POST /api/v1/products` with documented product fields; persist only after acknowledgement | Add dialog submits a product; accepted product is stored in localStorage and shown in catalog. | Pending state prevents repeat POST; validation/API errors are inline and fields remain on failure. Product state changes only after API acknowledgement outside demo mode. |
| Hide product (UC-08) | `DELETE /api/v1/products/{productId}`; persist hidden ID only after acknowledgement | Product action removes the item after API success. | Pending state disables the selected product only; on failure the item remains visible. Demo mode is clearly labeled and makes no API call. |
| Logout (UC-09) | `DELETE /api/v1/auth/sessions` with Bearer access JWT, refresh cookie, and CSRF proof | If the access JWT has expired, refresh it silently first, preserving the same `sid`, then submit logout. | Failure keeps the shop open for retry; success clears the in-memory session. No refresh interstitial is shown. |
| Inspect requests / learn JWT (FR-10) | Uses results from the documented operations; no separate call required | Inspector shows method, route, status, and short note; JWT explainer describes JWS parts. | Shows only method/route/status/summary, marks demo rows, and has a clear empty state. |

## Contract boundary notes

- `/` is the current frontend route; API paths above are backend endpoints proxied by Next.js. No additional frontend routes are assumed.
- `GET /api/v1/auth/sessions` is documented as a read-only endpoint, but the current UI does not call it. Keep it out of the UI until a product need is confirmed.
- OAuth provider routes are browser redirects, not JSON APIs. The app exchanges only the short-lived handoff code.
- Product additions and hides are mock actions acknowledged by the backend; localStorage is UI state, not authoritative server persistence.
- Live API, OAuth-provider, cookie, and CSRF behavior require a running backend and are not established by static source inspection.
