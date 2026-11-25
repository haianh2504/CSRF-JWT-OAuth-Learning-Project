# CSRF_JWT_OAuth

A Spring Boot learning project with a mock shop UI. Users sign up/sign in with email/password or Google/Facebook OAuth, then browse mock products, add products, and hide products while learning signed JWT (JWS) access-token authentication with opaque refresh-token rotation and revocation.

There is no relational database in the initial learning version. Demo accounts live in the running Spring Boot process's memory; Redis stores refresh-token hashes and session state. The backend validates requests and returns mock responses. The frontend persists accepted product additions and hidden product IDs in `localStorage`.

## Scope

- Email/password sign-up and sign-in.
- Google and Facebook OAuth.
- Authenticated shop page with a fixed mock catalog.
- Add and hide products.
- Request Inspector for bearer JWT requests.
- Logout.

See [PRD.md](PRD.md), [use_case.md](use_case.md), [api_contract.md](api_contract.md), and [testing_usecases.md](testing_usecases.md).

## JWT and refresh-token model

- The backend issues 10-minute access tokens as signed compact JWS JWTs: `header.payload.signature`. Base64URL encodes each part; the payload is readable, not encrypted.
- The frontend keeps the access JWT in JavaScript memory only (10-minute lifetime) and sends it as `Authorization: Bearer <access-token>` to protected business API endpoints.
- The backend issues a high-entropy opaque refresh token encoded with unpadded Base64URL. Each refresh token lives for 7 days and is held in an `HttpOnly; Secure; SameSite=Lax` cookie; frontend JavaScript cannot read it.
- On refresh, the backend validates the current refresh token, atomically consumes it, and rotates it to a new refresh token. Reuse of a consumed token revokes the token family/session.
- Redis stores only the SHA-256 hash of each refresh token and the required session/token-family metadata, with TTL. SHA-256 is one-way hashing, not encryption. Never store or log the raw refresh token or signing keys in Redis.
- Logout revokes the refresh-token session in Redis and clears the refresh and CSRF cookies. A previously issued access JWT may remain valid for up to 10 minutes after logout; access-token denylisting is not part of the selected design.
- Only `POST /api/v1/auth/refresh` and `DELETE /api/v1/auth/sessions` require CSRF validation. Use signed, session-bound Double Submit Cookie: the server sets a JavaScript-readable `XSRF-TOKEN` cookie, frontend copies its value to `X-CSRF-TOKEN`, and the server verifies the matching values and session binding. Other business APIs use the explicit Bearer header and do not require a CSRF token.

## OAuth token handoff

OAuth provider authorization codes are handled server-to-server. After callback validation, the backend creates a short-lived, single-use application handoff code. The frontend exchanges it at `POST /api/v1/auth/oauth/exchange` to receive an access JWT; the response also sets the refresh-token cookie. The app JWT is never placed in a redirect URL. Do not place JWTs in redirect URLs.

## Mock product persistence

- Backend serves a fixed mock catalog; no product database is used.
- After `POST /api/v1/products` succeeds, frontend stores the product in `localStorage`.
- After `DELETE /api/v1/products/{productId}` succeeds, frontend stores its ID as hidden and filters it out; this is a local soft-hide.
- On reload, frontend merges mock products with local additions and hidden IDs. Clearing browser storage resets local changes.
- Authentication tokens are never stored in localStorage/sessionStorage.

## Demo account storage

- A singleton backend in-memory user store (for example, a Spring service backed by `ConcurrentHashMap`) keeps demo accounts available across requests while one Spring Boot process is running.
- Store normalized email, account ID, BCrypt password hash, and the provider subject mapping needed for OAuth sign-in. Never store raw passwords.
- The store is process-local and volatile: restarting the backend clears all demo accounts, and multiple backend instances do not share accounts.
- `localStorage` is only for mock product UI state; it does not store accounts or authenticate users. Add PostgreSQL later only if persistence across backend restarts or shared accounts across instances becomes a project requirement.

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
| `DELETE` | `/api/v1/auth/sessions` | Revoke the current refresh-token session and clear its cookie. |

## Planned technology

Java 21 (confirm when scaffolding), Spring Boot, Spring Security, Spring Security OAuth2 Client, Maven, and Redis for refresh-token state. Demo accounts are in memory and reset on backend restart; there is no relational database initially.

## Run locally

To be completed after creating source code. Expected command:

```bash
./mvnw spring-boot:run
```

OAuth requires Google/Facebook client credentials. Use environment configuration or ignored local config; never commit secrets.

## Security notes

- Use Spring Security `BCryptPasswordEncoder`; never log passwords or tokens.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis. Use a secret manager/KMS for deployed environments.
- Use Redis TTL and atomic operations for shared OAuth handoff state and refresh-token rotation across instances. Each active refresh-token record expires after 7 days; retain consumed-token markers long enough to detect replay within the session policy. Store SHA-256 hashes and session metadata only; fail closed if refresh state cannot be checked. Never store signing keys or raw refresh tokens in Redis.
- Do not treat localStorage product state as trusted or server-authoritative.
