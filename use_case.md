# Use Cases — JWT OAuth Mock Shop

## 1. Actors and rules

- **Visitor:** not authenticated.
- **Authenticated user:** signed in through email/password or Google/Facebook OAuth.
- **Application:** Spring Boot and Spring Security backend with a minimal frontend.
- **Provider:** Google or Facebook.

Protected business APIs use a signed JWT bearer access token with a 10-minute lifetime. The access JWT is a compact JWS with three Base64URL-encoded parts; the payload is not encrypted. The frontend keeps the 10-minute access JWT in JavaScript memory only and sends it as `Authorization: Bearer <access-JWT>`. A separate high-entropy opaque refresh token is encoded as unpadded Base64URL and held for 7 days in an `HttpOnly; Secure; SameSite=Lax` cookie. Redis stores only the SHA-256 hash and session/token-family metadata. Refresh rotates tokens atomically and detects reuse; only refresh/logout enforce signed, session-bound Double Submit Cookie CSRF (`XSRF-TOKEN` cookie copied into `X-CSRF-TOKEN` header); business API requests using Bearer JWT do not require CSRF tokens.

The initial backend has no relational database. A singleton backend service holds demo accounts in a process-local in-memory map across requests; it stores normalized email, account ID, BCrypt password hash, and OAuth provider identity mapping. The data is lost when that Spring Boot process restarts and is not shared across multiple backend instances. Redis stores hashed refresh-token state. Product mutations are acknowledged but not stored server-side. Frontend stores added products and hidden IDs in `localStorage`; authentication credentials are not stored in browser storage accessible to JavaScript.

## 2. Endpoint map

| UC | Method and endpoint | Purpose |
|---|---|---|
| UC-01 | `POST /api/v1/auth/signup` | Create in-memory account with email/password. |
| UC-02 | `POST /api/v1/auth/signin` | Verify credentials; return access JWT and set refresh cookie. |
| UC-03 | `GET /oauth2/authorization/google` | Start Google OAuth. |
| UC-03 callback | `GET /login/oauth2/code/google` | Backend callback; validates state and creates one-time app handoff code. |
| UC-04 | `GET /oauth2/authorization/facebook` | Start Facebook OAuth. |
| UC-04 callback | `GET /login/oauth2/code/facebook` | Backend callback; validates state and creates one-time app handoff code. |
| UC-05 | `POST /api/v1/auth/oauth/exchange` | Exchange handoff code for access JWT and refresh cookie. |
| UC-10 | `POST /api/v1/auth/refresh` | Rotate refresh token and issue new access JWT. |
| UC-06 | `GET /api/v1/homepage` | Return authenticated shop information. |
| UC-06 | `GET /api/v1/products` | Return fixed mock catalog. |
| UC-07 | `POST /api/v1/products` | Acknowledge product add; backend does not persist. |
| UC-08 | `DELETE /api/v1/products/{productId}` | Acknowledge hide; backend does not delete a record. |
| UC-09 | `DELETE /api/v1/auth/sessions` | Revoke refresh-token session and clear cookie; frontend clears access JWT. |

Protected business endpoints require bearer access JWT. Sign-up, sign-in, OAuth handoff exchange, and refresh are pre-access-token endpoints; refresh/logout use the refresh cookie with CSRF/origin protection. OAuth routes use browser redirects and are not JSON envelope endpoints.

## UC-01 — Sign up with email/password

1. Visitor submits email and password to `POST /api/v1/auth/signup`.
2. Backend normalizes email, validates fields, atomically checks uniqueness in the in-memory user store, hashes password using Spring Security `BCryptPasswordEncoder`, and stores the account in the running process's memory.
3. Backend returns a safe user summary, not a JWT or password/hash.
4. Visitor proceeds to sign in.

Errors: invalid fields (400), duplicate email (409), unexpected error (500 envelope). The account can be used by subsequent requests handled by this process, but is lost after backend restart; a separate backend instance has its own independent store.

## UC-02 — Sign in with email/password

1. Visitor submits credentials to `POST /api/v1/auth/signin`.
2. Backend verifies with `PasswordEncoder.matches`.
3. Backend returns a signed compact JWS access token with a 10-minute expiry and token type `Bearer`, and sets a separate 7-day opaque refresh-token cookie.
4. Frontend keeps only the access JWT in memory and navigates to shop.

Invalid credentials return generic 401. The refresh token is not returned in JSON or exposed to JavaScript. Reloading clears the access JWT; the frontend can call refresh to obtain a new access/refresh pair.

## UC-03/04 — Sign in through Google/Facebook

1. Frontend opens backend authorization route, preferably in a popup or same-tab flow.
2. Backend redirects to provider with OAuth state.
3. Provider authenticates user and redirects authorization code/state to the backend callback.
4. Backend validates state and exchanges provider code server-to-server; provider code is never sent to frontend.
5. Backend maps/provisions local account and creates short-lived, single-use application handoff code.
6. Callback redirects to a fixed frontend callback URL with only the handoff code.
7. Frontend redeems the code at `POST /api/v1/auth/oauth/exchange`.
8. Backend consumes code once, returns a 10-minute access JWT and user summary, and sets the 7-day opaque refresh-token cookie.
9. Frontend keeps the access JWT in memory and opens shop.

Reject denied consent, state mismatch/replay, invalid/expired code, provider mismatch, missing required claims, and unconfigured provider. JWT must never appear in callback URL. In popup mode use `postMessage` with exact-origin validation.

## UC-05 — Exchange OAuth handoff code

1. Frontend sends the short-lived handoff code to `POST /api/v1/auth/oauth/exchange`.
2. Backend verifies expiry, one-time state, provider/principal association, and consumes code atomically.
3. Backend issues a 10-minute signed access JWT, sets a 7-day opaque refresh-token cookie, and returns the access token/user summary in the JSON envelope.
4. Replay/expired/malformed codes fail without issuing credentials.

## UC-10 — Refresh access token

1. When an API reports that the access JWT has expired, frontend calls `POST /api/v1/auth/refresh` with credentials enabled; the browser sends the HttpOnly refresh cookie.
2. Frontend copies the JavaScript-readable `XSRF-TOKEN` cookie value into the `X-CSRF-TOKEN` header; backend verifies equality and session-bound signature. This check is required only on refresh/logout.
3. Backend hashes the opaque token with SHA-256 and checks Redis for the current, unexpired, unrevoked token record.
4. Backend atomically consumes the old token, stores the new token hash, returns a new 10-minute access JWT, and sets the rotated refresh cookie with a fresh 7-day lifetime.
5. Frontend replaces the in-memory access JWT and retries the failed API request once.
6. If an already-consumed token is reused, backend revokes the token family/session and requires sign-in. Redis failure fails closed.

Unknown, expired, revoked, or replayed refresh tokens return 401; invalid CSRF proof returns 403. Concurrent refresh requests must be serialized by the frontend to avoid submitting the same token twice.

## UC-06 — View shop and mock catalog

1. Authenticated client requests `GET /api/v1/homepage` and `GET /api/v1/products` with bearer JWT.
2. Backend returns safe user/shop data and fixed mock products.
3. Frontend merges base products with local additions and filters locally hidden IDs.
4. Invalid local data is handled without crashing; no pagination metadata is returned.

Unauthenticated/invalid/expired JWT receives 401. Read-only GET needs JWT only.

## UC-07 — Add product

1. User submits product form.
2. Frontend sends `POST /api/v1/products` with bearer JWT.
3. Backend validates JWT and product fields, then returns an acknowledgement without server persistence.
4. Only after success, frontend stores the returned product in localStorage and renders it.

Invalid JWT returns 401. Invalid product fields return 400; no local update. Storage failure is shown as a local persistence failure.

## UC-08 — Hide product

1. User selects Hide.
2. Frontend sends `DELETE /api/v1/products/{productId}` with bearer JWT.
3. Backend validates and acknowledges without database deletion.
4. Frontend stores ID in local hidden-ID list and filters product out.

Invalid JWT returns 401. Unknown/malformed IDs follow the API contract; no local state changes before a successful response.

## UC-09 — Logout

1. Frontend sends `DELETE /api/v1/auth/sessions` with the refresh cookie and required CSRF/origin proof; a valid access JWT is not required.
2. Backend revokes the refresh-token family/session in Redis and expires both refresh and CSRF cookies.
3. Frontend clears the in-memory access JWT and returns to sign-in. Any already-issued access JWT may remain valid for up to 10 minutes from issuance.
4. Product localStorage remains per project policy.
