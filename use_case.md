# Use Cases — JWT OAuth Mock Shop

## 1. Actors and rules

- **Visitor:** not authenticated.
- **Authenticated user:** signed in through email/password or Google/Facebook OAuth.
- **Application:** Spring Boot and Spring Security backend with a minimal frontend.
- **Provider:** Google or Facebook.
- **Admin:** trusted operator who can lock an account; management endpoint and admin authorization remain TBD.

Local JWT configuration is `iss: http://localhost:8080` (Spring backend) and `aud: http://localhost:3000` (frontend app audience, selected for this learning project). Conventionally, an access-token audience identifies the API/resource server that validates the bearer token; the frontend audience is an intentional learning choice and the backend validates it exactly. Server-issued tokens omit `role`, and the backend rejects any otherwise-valid signed access JWT containing `role`.

Protected business APIs use a signed JWT bearer access token with a maximum 10-minute lifetime. Each successful login creates a UUID v4 `sid` shared by the access JWTs and opaque refresh-token family. The session family has a fixed 15-day absolute lifetime from login; refresh cannot extend it. Each refresh token has up to 7 days idle lifetime, capped at family expiry. Access-token `exp` is capped at family expiry. Consumed refresh-token hashes are retained only until that token's original 7-day expiry (bounded by family expiry); replay before that expiry revokes the family. After JWT signature, issuer/audience, claims, and time validation, protected requests check the `sid` denylist in local Redis; a match is rejected. `jti` is a fresh UUID v4 per access JWT. Redis maps refresh-token hashes to `sid`, tracks absolute session expiry and latest access-token `exp`, and stores `deny:session:<sid>` through that latest expiry. A deny-listed `sid` also makes refresh fail. Validate each access JWT's `iat`, `exp`, and maximum lifetime (`exp - iat`) before checking session/denylist state; fail closed if Redis is unavailable. Sign and verify access JWTs with HS256 using a one-time provisioned 32-byte key; this project has no signing-key rotation. Claims include `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `sid`, and `token-type: access`; no `role` claim is ever issued. The frontend keeps the access JWT in memory and sends it as `Authorization: Bearer <access-JWT>`. Refresh remains an opaque random value in an `HttpOnly; SameSite=Lax` cookie (`Secure` off only for local HTTP, on for HTTPS). For refresh/logout, generate an unpredictable CSRF value with `SecureRandom`, store its SHA-256 hash in local Redis keyed by `sid`, set it in the JavaScript-readable `XSRF-TOKEN` cookie, and require the same value in `X-CSRF-TOKEN`. The server compares cookie/header and the session hash; no signature is used. Bearer business APIs do not require CSRF.

The initial backend has no relational database and runs as one backend instance. A singleton backend service holds demo accounts in process memory; the data resets on restart. One local Redis instance stores refresh-token hashes mapped to `sid`, session metadata, active-session indexes, account-lock state, session denylist entries, CSRF-token hashes, OAuth state and handoff-code hashes. Redis is not shared across backend instances. Product mutations are acknowledged but not stored server-side. Frontend stores added products and hidden IDs in `localStorage`; authentication credentials are not stored there.

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
| UC-09 | `DELETE /api/v1/auth/sessions` | Require access JWT and CSRF; revoke entire session family, deny-list `sid`, and clear cookies. |

Protected business endpoints require bearer access JWT. Sign-up, sign-in, OAuth handoff exchange, and refresh are pre-access-token endpoints. Refresh uses the refresh cookie with CSRF/origin protection; logout requires the access JWT, refresh cookie, and CSRF/origin proof. OAuth routes use browser redirects and are not JSON envelope endpoints.

## UC-01 — Sign up with email/password

1. Visitor submits email and password to `POST /api/v1/auth/signup`.
2. Backend normalizes email, validates fields, atomically checks uniqueness in the in-memory user store, hashes password using Spring Security `BCryptPasswordEncoder`, and stores the account in the running process's memory.
3. Backend returns a safe user summary, not a JWT or password/hash.
4. Visitor proceeds to sign in.

Errors: invalid fields (400), duplicate email (409), unexpected error (500 envelope). The account can be used by subsequent requests handled by this process, but is lost after backend restart; a separate backend instance has its own independent store.

## UC-02 — Sign in with email/password

1. Visitor submits credentials to `POST /api/v1/auth/signin`.
2. Backend verifies with `PasswordEncoder.matches`.
3. Backend creates a UUID v4 `sid` with a 15-day absolute expiry, returns a signed compact JWS access token expiring at `min(now + 10 minutes, session expiry)` with a fresh UUID v4 `jti`, and sets a separate opaque refresh-token cookie mapped to the same `sid` with expiry `min(now + 7 days, session expiry)`.
4. Frontend keeps only the access JWT in memory and navigates to shop.

Invalid credentials return generic 401. The refresh token is not returned in JSON or exposed to JavaScript. Reloading clears the access JWT; the frontend can call refresh to obtain a new access/refresh pair.

## UC-03/04 — Sign in through Google/Facebook

1. On a user click, frontend opens the backend authorization route in a popup. The current app page stays open.
2. Backend creates separate 32-byte random OAuth `state` and browser-binding values with `SecureRandom`, encodes them as unpadded Base64URL, stores only their hashes plus provider, exact callback, expiry, and PKCE verifier in local Redis with a 5-minute TTL, sets the browser-binding value in a short-lived HttpOnly SameSite=Lax cookie at `Path=/login/oauth2/code` (not the OpenID Connect `nonce`), and redirects to Google/Facebook with state and the PKCE S256 challenge.
3. Google/Facebook authenticates the user and redirects the popup browser to the backend callback with its one-time authorization code and the same `state`; the provider does not send a direct server-to-server callback.
4. Backend verifies the state, browser-binding cookie, provider, and callback, then atomically consumes/deletes the matching Redis state record. It keeps the PKCE verifier only in callback memory while exchanging the provider code server-to-server; provider code is never sent to frontend.
5. Backend resolves the local account using `(provider, stable subject)` and the account-linking policy below, then creates a 32-byte random handoff code. Redis stores only its SHA-256 hash and verified account/provider reference for 60 seconds.
6. Backend redirects the popup to the exact allowlisted frontend callback URL with only `?handoff=<app-handoff-code>`; the provider's `?code=` is used only by the backend callback. Never put the app JWT in this URL.
7. The popup callback copies the handoff value to memory, immediately removes it from its URL/history, then sends `{ type: "OAUTH_HANDOFF", code: "..." }` to the opener with `postMessage` using the exact frontend origin. The opener validates `event.origin`, `event.source`, and payload shape.
8. The opener redeems the handoff code at `POST /api/v1/auth/oauth/exchange`. Backend atomically consumes and deletes its Redis record, creates a new login `sid` with 15-day absolute expiry, returns an access JWT with a fresh `jti` and expiry no later than 10 minutes or session expiry, and sets refresh/CSRF cookies. Refresh expires after at most 7 idle days and cannot extend the family. The popup never receives or sends the app JWT; it closes after the opener confirms receipt.

Reject denied consent, state mismatch/replay, invalid/expired code, provider mismatch, missing required claims, and unconfigured provider. JWT must never appear in callback URL or `postMessage`. Provider identities are keyed by `(provider, stable subject)`, not email alone. Do not auto-link a new provider identity to an existing account based only on matching email; require an authenticated explicit linking flow, which is out of scope for this learning version. Reject missing/unverified provider email and matching-email conflicts with a safe sign-in error. A new verified email with no existing account may create a local account.

## UC-05 — Exchange OAuth handoff code

1. Frontend sends the short-lived handoff code to `POST /api/v1/auth/oauth/exchange`.
2. Backend verifies expiry, one-time state, provider/principal association, and consumes code atomically.
3. Backend atomically consumes and deletes the handoff record, creates a new login `sid` with 15-day absolute expiry, issues an access JWT with a fresh `jti` and expiry no later than 10 minutes or session expiry, sets a refresh cookie expiring at `min(now + 7 days, session absolute expiry)`, and returns the access token/user summary.
4. Replay/expired/malformed codes fail without issuing credentials.

## UC-10 — Refresh access token

1. When an API reports that the access JWT has expired, frontend calls `POST /api/v1/auth/refresh` with credentials enabled; the browser sends the HttpOnly refresh cookie.
2. Frontend copies the JavaScript-readable `XSRF-TOKEN` cookie value into the `X-CSRF-TOKEN` header; backend verifies cookie/header equality and compares the token hash with the local Redis value for the session `sid`. The token is generated with `SecureRandom`, stored by hash, and is not signed. This check is required only on refresh/logout.
3. Backend hashes the opaque token with SHA-256 and checks Redis for the current, unexpired, unrevoked token record.
4. Backend atomically consumes the old token, retains its hash marker only until its original expiry, stores the new token hash mapped to the same `sid`, returns a new access JWT with a fresh `jti` and unchanged `sid` (`exp` no later than 10 minutes or session expiry), updates latest `exp`, and sets the rotated refresh cookie with expiry `min(now + 7 days, session absolute expiry)`.
5. Frontend replaces the in-memory access JWT and retries the failed API request once.
6. If an already-consumed token is reused before its original expiry, backend revokes the token family/session and requires sign-in. A replay after that token's expiry still returns 401 but cannot refresh; Redis failure fails closed.

Unknown, expired, revoked, or replayed refresh tokens return 401; missing or invalid CSRF proof returns 403; unavailable Redis returns 503 `SERVICE_UNAVAILABLE` and the operation fails closed. Consumed-token replay before its original expiry revokes the family; after expiry it is rejected without treating it as a live-token replay. Concurrent refresh requests must be serialized by the frontend to avoid submitting the same token twice.

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

1. Frontend sends `DELETE /api/v1/auth/sessions` with `Authorization: Bearer <access-JWT>`, refresh cookie, and CSRF/origin proof. If access JWT has expired, it silently refreshes first; the refreshed JWT keeps the same `sid`.
2. Backend validates JWT signature, claims, expiry, CSRF/session binding, and that JWT `sid` matches the refresh session.
3. Backend atomically revokes the full refresh-token family and stores `deny:session:<sid>` in Redis. TTL is `max(0, latestSessionAccessExp - currentTime)`, using session metadata updated on every access-token issuance/refresh. It expires refresh and CSRF cookies.
4. Protected requests validate signature/claims/time first, then check `sid`; every access JWT in the deny-listed session receives 401. Frontend clears its in-memory access JWT after successful logout; product localStorage remains per project policy.

## Admin-triggered account lock

When a trusted admin action locks an account, backend stores the lock state in Redis, prevents new sign-in/refresh, revokes every active refresh-token family, and deny-lists every active `sid` through its latest access-token `exp`. Every access JWT in those sessions is rejected after signature/claims/time validation. Admin endpoint and authorization details remain TBD.
