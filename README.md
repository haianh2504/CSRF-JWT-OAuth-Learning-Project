# CSRF_JWT_OAuth

A Spring Boot learning project with a mock shop UI. Users sign up/sign in with email/password or Google/Facebook OAuth, then browse mock products, add products, and hide products while learning signed JWT (JWS) access-token authentication with opaque refresh-token rotation and revocation.

There is no relational database in the initial learning version. Run one Spring Boot backend instance; demo accounts live in its memory. One local Redis instance stores refresh-token hashes, session state, account lock state, CSRF token hashes, OAuth state/handoff hashes, and session denylist entries keyed by `sid`. Redis is not shared across multiple backend instances. The backend validates requests and returns mock responses. The frontend persists accepted product additions and hidden product IDs in `localStorage`.

## Scope

- Email/password sign-up and sign-in.
- Google and Facebook OAuth.
- Authenticated shop page with a fixed mock catalog.
- Add and hide products.
- Request Inspector for bearer JWT requests.
- Logout.

See [PRD.md](PRD.md), [use_case.md](use_case.md), [api_contract.md](api_contract.md), and [testing_usecases.md](testing_usecases.md).

## JWT and refresh-token model

- The backend issues 10-minute access tokens as signed compact JWS JWTs: `header.payload.signature`. Base64URL encodes each part; the payload is readable, not encrypted. Only access tokens are JWTs in this design; refresh tokens are opaque random strings, not JWTs.
- JWTs use symmetric HS256 signing (HMAC-SHA-256). The signing input is the two Base64URL-encoded header and payload segments joined by `.`, and the signature is `Base64URL(HMAC-SHA256(secretKey, headerSegment + '.' + payloadSegment))`. The verifier accepts only `alg: HS256` and compares the HMAC signature before trusting claims.
- Provision the 32-byte (256-bit) secret key once using a cryptographically secure random generator such as Java `SecureRandom`. Keep it in local environment configuration or a deployed secret manager/KMS. Reuse the configured key for signing and verification across logins and restarts; there is no signing-key rotation in this project. Refresh-token rotation is the only rotation mechanism. Never generate the signing key per login/startup, hardcode it in source, send it to the frontend, put it in a JWT, or store it in Redis.
- Local JWT values are `iss: http://localhost:8080` (Spring backend) and `aud: http://localhost:3000` (frontend app audience selected for this learning project). The backend validates both. Conventionally, an access-token audience names the API/resource server that validates the bearer token; the frontend audience here is an intentional learning choice.
- Access JWT claims: `iss`, `sub`, `aud`, `exp`, `iat`, `jti` (fresh UUID v4 per access token), `sid` (UUID v4 created once per successful login and shared across that session's access/refresh lifecycle), and `token-type: access`. Refresh preserves `sid` while rotating the opaque refresh token and issuing a fresh access JWT/`jti`. The server never issues a `role` claim, and the validator rejects any signed access JWT that contains `role`.
- The JSON response field `tokenType: "Bearer"` tells the client which Authorization scheme to use (`Authorization: Bearer <accessToken>`). The JWT payload claim `token-type: "access"` identifies the token's purpose. They are separate fields and must not be confused or substituted.
- The frontend keeps the access JWT in JavaScript memory only (10-minute lifetime) and sends it as `Authorization: Bearer <access-token>` to protected business API endpoints.
- The backend issues a high-entropy opaque refresh token encoded with unpadded Base64URL. Each refresh token has a 7-day idle lifetime; the session family has a 15-day absolute lifetime from login that refresh cannot extend. The cookie is `HttpOnly; SameSite=Lax`; `Secure` is disabled only for local HTTP development and always enabled in HTTPS deployments.
- On refresh, the backend validates the current refresh token, atomically consumes it, and rotates it to a new refresh token whose expiry is capped at the session's 15-day absolute expiry. Reuse while a consumed token is within its original 7-day lifetime revokes the family/session. Keep its hash until that original expiry (at most 7 days), bounded by family expiry; afterward it cannot refresh and returns 401.
- Local Redis maps each SHA-256 refresh-token hash to its `sid` and stores session-family metadata (including latest access-token `exp`) plus a denylist keyed by `sid`. A deny-listed `sid` rejects every access JWT and refresh attempt for that session. Its TTL reaches the latest access-token `exp` in the session. Never store or log raw refresh tokens, full JWTs, or signing keys in Redis.
- Logout sends the current access JWT in `Authorization: Bearer`, the refresh cookie, and CSRF proof. The backend revokes the entire refresh-token family, deny-lists its `sid` until every access JWT in that session expires, and clears refresh/CSRF cookies. An admin account lock revokes all active sessions for that account the same way. Protected API requests check `sid` after validating signature, claims, and expiry; Redis check failures fail closed.
- `POST /api/v1/auth/refresh` and `DELETE /api/v1/auth/sessions` require a per-session CSRF value generated with `SecureRandom`. The backend stores its SHA-256 hash in local Redis by `sid`; the frontend copies the JavaScript-readable `XSRF-TOKEN` cookie to `X-CSRF-TOKEN`; the backend verifies both match and match the stored session hash. The CSRF value is not signed. Other business APIs use Bearer authentication and do not require CSRF.

## OAuth token handoff

OAuth uses a popup. Backend generates separate 32-byte `SecureRandom` state and browser-binding values; state and handoff code are unpadded Base64URL, and Redis stores only their SHA-256 hashes. State expires after 5 minutes; handoff code after 60 seconds. Each Redis record is atomically deleted when successfully consumed. Google/Facebook returns its authorization code and the same state to the backend callback; the backend checks state/browser binding and exchanges the provider code server-to-server. The backend then redirects the popup to the fixed frontend callback with only `?handoff=<app-code>` (the provider's `?code=` never reaches the frontend). The callback removes `handoff` from the URL and sends it to the opener via exact-origin `postMessage`; the opener exchanges it for the app session. The app JWT is never placed in a redirect URL or sent via `postMessage`.

## Mock product persistence

- Backend serves a fixed mock catalog; no product database is used.
- After `POST /api/v1/products` succeeds, frontend stores the product in `localStorage`.
- After `DELETE /api/v1/products/{productId}` succeeds, frontend stores its ID as hidden and filters it out; this is a local soft-hide.
- On reload, frontend merges mock products with local additions and hidden IDs. Clearing browser storage resets local changes.
- Authentication tokens are never stored in localStorage/sessionStorage.

## Demo account storage

- A singleton backend in-memory user store (for example, a Spring service backed by `ConcurrentHashMap`) keeps demo accounts available across requests while one Spring Boot process is running.
- Store normalized email, account ID, BCrypt password hash, and the provider subject mapping needed for OAuth sign-in. Never store raw passwords.
- The store is process-local and volatile: restarting the single backend clears all demo accounts. This learning setup runs one backend instance and does not share Redis across instances.
- `localStorage` is only for mock product UI state; it does not store accounts or authenticate users. Add PostgreSQL later only if persistence across backend restarts becomes a project requirement.

## Endpoint overview

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register with email/password. |
| `POST` | `/api/v1/auth/signin` | Sign in; return 10-minute access JWT and set 7-day refresh-token cookie. |
| `GET` | `/oauth2/authorization/google` | Start Google OAuth. |
| `GET` | `/login/oauth2/code/google` | Google callback. |
| `GET` | `/oauth2/authorization/facebook` | Start Facebook OAuth. |
| `GET` | `/login/oauth2/code/facebook` | Facebook callback. |
| `POST` | `/api/v1/auth/oauth/exchange` | Exchange one-time OAuth handoff code for access JWT and refresh-token cookie. |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh token and issue a new access JWT. |
| `GET` | `/api/v1/homepage` | Return authenticated shop data. |
| `GET` | `/api/v1/products` | Return fixed mock catalog. |
| `POST` | `/api/v1/products` | Validate/acknowledge product add; frontend persists locally. |
| `DELETE` | `/api/v1/products/{productId}` | Validate/acknowledge product hide; frontend persists locally. |
| `DELETE` | `/api/v1/auth/sessions` | Require access JWT and CSRF; revoke its session family, deny-list `sid`, and clear cookies. |

## Planned technology

Java 21 (confirm when scaffolding), Spring Boot, Spring Security, Spring Security OAuth2 Client, Maven, and Redis for refresh/session revocation state. Demo accounts are in memory and reset on backend restart; there is no relational database initially.

## Run locally

To be completed after creating source code. Expected command:

```bash
./mvnw spring-boot:run
```

OAuth requires Google/Facebook client credentials. Use environment configuration or ignored local config; never commit secrets.

## Security notes

- Use Spring Security `BCryptPasswordEncoder`; never log passwords or tokens.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis. Use a secret manager/KMS for deployed environments.
- Local development uses frontend `http://localhost:3000` and backend `http://localhost:8080` through the existing Next.js rewrite proxy; browser calls stay same-origin, so CORS is not needed. The proxy must forward cookies upstream and preserve `Set-Cookie`. Use host-only cookies (no `Domain`), refresh cookie path `/api/v1/auth`, readable `XSRF-TOKEN` path `/`, OAuth browser-binding path `/login/oauth2/code`, and `SameSite=Lax`. Disable `Secure` only for local HTTP; production uses HTTPS and `Secure` cookies. If using direct browser-to-backend calls, enable credentials and allow the exact frontend origin, never `*`. Verify the Vercel proxy preserves cookies and OAuth callback allowlists before deployment.
- Run one backend instance with one local Redis instance; Redis is not shared across backend instances. Use TTL and atomic operations for OAuth state/handoff, refresh-token rotation and session revocation. Store SHA-256 refresh-token hashes mapped to `sid`, session metadata (absolute session expiry 15 days after login), CSRF-token hashes, OAuth state/handoff hashes, account/session indexes, account-lock state, and session denylist entries keyed by `sid` through the latest access-token `exp`; never store full JWTs, signing keys, raw refresh tokens, or raw OAuth state/handoff codes in Redis. Each refresh token lives up to 7 days, capped by the session expiry; retain consumed-token hashes only until their original expiry (maximum 7 days), bounded by the session expiry. Fail closed if Redis state cannot be checked.
- Do not treat localStorage product state as trusted or server-authoritative.
