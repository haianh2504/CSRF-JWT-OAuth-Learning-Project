# PRD — JWT & OAuth Mock Shop

## 1. Purpose

Build a small Spring Boot learning application with a mock shop UI. The project covers email/password authentication, Google/Facebook OAuth, signed JWT (JWS) authentication, and basic product actions. There is no product database.

## 2. Goals

- Issue and validate a backend-signed JWT.
- Inspect the compact JWS structure: three Base64URL-encoded parts (`header.payload.signature`). The payload is not encrypted.
- Send JWT through `Authorization: Bearer <JWT>`.
- Practice OAuth login and safe handoff of authentication to the frontend.
- Browse mock products, add products, and hide products.

## 3. Scope

### In scope

- Email/password sign-up and sign-in.
- Continue with Google and Facebook OAuth.
- Authenticated shop page with a fixed mock catalog.
- Add and hide product actions.
- Request Inspector showing JWT bearer requests.
- Logout and unauthenticated states.

### Out of scope

- Database-backed accounts or products, real inventory, cart, checkout, or payment.
- Access JWT stored in cookies, `localStorage`, or `sessionStorage`.
- Production deployment and production-grade infrastructure beyond the documented Redis-backed refresh-token rotation and session-revocation flow.

## 4. Authentication and token design

- Protected business APIs use a backend-signed compact JWS JWT access token with a 10-minute lifetime. The frontend keeps it in JavaScript memory only and sends it as `Authorization: Bearer <access-token>`.
- Sign-up/sign-in and OAuth exchange are pre-authentication endpoints. Successful sign-in and OAuth exchange return an access JWT and set a refresh-token cookie.
- The refresh token is a high-entropy opaque random value encoded with unpadded Base64URL; it is not a JWT and carries no claims. Each token lives for 7 days and the browser stores it in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to authentication endpoints.
- Each successful login creates one session ID (`sid`). Redis maps each refresh-token hash to its session and stores a session denylist keyed by `sid`; a match rejects every access JWT in that session and any refresh attempt mapped to that session. Redis never stores raw refresh tokens, full JWTs, or signing keys. The entry TTL covers the latest unexpired access JWT in the session.
- `POST /api/v1/auth/refresh` atomically consumes the presented refresh token, issues a new access JWT and refresh token, and detects reuse of a consumed token. Reuse revokes the token family/session.
- Logout requires the current access JWT, refresh-token cookie, and CSRF proof. It revokes the refresh-token family and adds the session's `sid` to the Redis denylist, immediately rejecting every access JWT in that session. The backend refreshes an expired access JWT silently before submitting logout when the refresh session remains valid.
- The JWT has three Base64URL-encoded segments: header, payload, signature. Base64URL encoding is not encryption; claims must not contain secrets. Only access tokens are JWTs; refresh tokens remain opaque.
- Sign and verify access JWTs with symmetric HS256 (HMAC-SHA-256). The JWS signing input is `<base64url(header)>.<base64url(payload)>`; the signature is `Base64URL(HMAC-SHA256(secretKey, signingInput))`. Accept only `alg: HS256`.
- Generate one 32-byte (256-bit) signing key with a cryptographically secure random generator (for example, Java `SecureRandom`) during secret provisioning. Load the same configured key for signing and verification; do not generate a new key per login or application restart. This project has no signing-key rotation; refresh-token rotation is the only rotation mechanism. Keep it outside source code, frontend responses, JWT contents, and Redis; use local environment configuration and a secret manager/KMS in deployed environments.
- Required access-token claims: `iss` (`http://localhost:8080`, the local Spring backend issuer), `sub` (stable account ID represented by the token), `aud` (`http://localhost:3000`, the local frontend app audience chosen for this learning project), `exp` (expiry time), `iat` (issue time), `jti` (a fresh random UUID v4 for each access token), `sid` (a random UUID v4 generated once at successful login and shared by all tokens in that session), and `token-type` with value `access`. Never reuse `jti` or `sid`; refresh keeps the same `sid` for the lifetime of the session. Do not issue a `role` claim and reject any access JWT containing one, even when its signature is valid; roles are outside this project's scope. The opaque refresh token has no JWT claims. Note: `aud` conventionally identifies the protected API that validates an access token; frontend as audience is an intentional learning choice here.
- In JSON authentication responses, `tokenType: "Bearer"` names the Authorization scheme; the separate JWT payload claim `token-type: "access"` identifies the token as an access token. They are not interchangeable.
- Only refresh and logout require CSRF validation. Generate one unpredictable CSRF value per login session with `SecureRandom`, store only its SHA-256 hash in local Redis keyed by `sid`, issue it in a JavaScript-readable `XSRF-TOKEN` cookie, and require the frontend to copy it to `X-CSRF-TOKEN`. Backend verifies cookie/header equality and constant-time match with the session's stored hash; the CSRF token is not signed. Bearer-authenticated business API requests do not require CSRF tokens.
- OAuth `state`, provider authorization code, application handoff code, application JWT, and provider access token are separate values. Store state and handoff-code hashes with TTL in the local Redis instance; use atomic single-use consumption. OAuth uses the same-tab flow in this project.

## 5. Mock data and persistence

- Demo accounts are held by a singleton backend in-memory store (for example, a Spring service backed by `ConcurrentHashMap`) for the lifetime of one Spring Boot process. Store only the account ID, normalized email, BCrypt password hash, and required OAuth provider identity mapping; never store raw passwords. A restart clears the store, and separate backend instances do not share it.
- `localStorage` is only for the frontend's mock product additions and hidden product IDs. It is not an account store and is not authoritative for authentication.
- The backend returns a fixed mock catalog and does not persist product changes.
- After a successful `POST /api/v1/products`, the frontend saves the product in `localStorage`.
- After a successful `DELETE /api/v1/products/{productId}`, the frontend saves the ID as hidden and filters the product out. This is local soft-hide, not server deletion.
- On page load, the frontend merges the fixed catalog with local additions and filters hidden IDs.
- The 10-minute access JWT is kept in JavaScript memory only; the 7-day refresh token is kept only in the HttpOnly cookie, never localStorage/sessionStorage.

## 6. Main flows

### Sign-up/sign-in

A visitor signs up with email/password. The backend validates the request, hashes the password with `BCryptPasswordEncoder`, and stores the account in the running process's in-memory user store. Sign-in looks up that account and uses `PasswordEncoder.matches`; it returns a backend-issued JWS and safe user summary. Accounts disappear when the backend process stops or restarts.

### OAuth

1. The browser opens the backend OAuth authorization route.
2. Backend redirects to Google or Facebook.
3. Provider returns an authorization code and state to the backend callback.
4. Backend validates state, exchanges the provider code server-to-server, and resolves the application account.
5. Backend creates a short-lived, single-use application handoff code stored in local Redis.
6. Same-tab frontend callback receives the handoff code and calls `POST /api/v1/auth/oauth/exchange`.
7. Backend consumes the code once, returns a 10-minute access JWT in JSON, and sets a 7-day refresh-token cookie.

Provider authorization codes and application JWTs must not be placed in frontend redirect URLs. The selected same-tab flow leaves the app temporarily and returns to the callback; popup is an alternative that keeps the app visible but needs popup handling and exact-origin `postMessage` validation. Same-tab was selected for simpler behavior and mobile support.

### Shop actions

The authenticated client calls `GET /api/v1/homepage` and `GET /api/v1/products`. Product add/hide requests require a JWT. The backend validates and acknowledges the action; the frontend updates `localStorage` only after success.

## 7. Functional requirements

- FR-01: Sign up with email/password.
- FR-02: Sign in with email/password and receive a signed JWT.
- FR-03: Sign in with Google OAuth.
- FR-04: Sign in with Facebook OAuth.
- FR-05: Exchange a one-time OAuth handoff code for the app JWT.
- FR-06: Protect homepage and product endpoints with bearer JWT.
- FR-07: Return a fixed mock product catalog without pagination metadata.
- FR-08: Add a product; after backend acknowledgement, persist it in browser `localStorage`.
- FR-09: Hide a product; after backend acknowledgement, persist its ID in local hidden IDs.
- FR-10: Show JWS structure and inspect bearer requests in the local learning UI.
- FR-11: Logout requires the access JWT, refresh-token cookie, and CSRF proof; it revokes the whole refresh-token family, deny-lists the session `sid` in Redis until the latest access JWT in that session expires, clears cookies, and clears the access JWT from client memory.
- FR-12: Validate request fields and return safe error responses.
- FR-13: Refresh an expired access JWT by rotating the opaque refresh token and issuing a new access JWT.
- FR-14: Detect reuse of a rotated refresh token and revoke the associated token family/session.
- FR-15: When an authorized admin locks an account, prevent new sign-in/refresh, revoke all its active refresh-token families, and deny-list every active session `sid` until its latest access JWT expires.

## 8. Security requirements

- Hash passwords with Spring Security `BCryptPasswordEncoder`; never store plaintext passwords.
- Keep OAuth client secrets and the 32-byte HS256 signing key out of Git, frontend code/responses, JWT contents, and Redis. Provision the key with a cryptographically secure random generator and load it from environment configuration locally or a secret manager/KMS in deployed environments; keep it stable across logins and restarts.
- Run one backend instance with one local Redis instance; Redis is not shared across backend instances. Store SHA-256 refresh-token hashes mapped to `sid`, session metadata (including latest access-token `exp`, initialized at login and updated on refresh), per-account active-session indexes, account-lock state, `sid` denylist entries, CSRF token hashes, OAuth state hashes, and OAuth handoff-code hashes. Never store raw refresh tokens, complete JWTs, or signing keys. After verifying JWT signature and claims/time validity, check the `sid` denylist before authorizing. Refresh tokens are opaque and checked against Redis token-family/session state; reject refresh when its `sid` is deny-listed, revoked, or locked. Compute denylist TTL as `max(0, latestSessionAccessExp - currentTime)`; validate each access token's `iat`, `exp`, and maximum lifetime (`exp - iat`). Revoke all refresh families and deny-list all active `sid` values when an admin lock occurs. Fail closed when Redis is unavailable for these checks.
- Protect refresh and logout with a session-bound `SecureRandom` CSRF token stored by SHA-256 hash in Redis; require matching `XSRF-TOKEN` cookie and `X-CSRF-TOKEN` header. No CSRF signature is needed. Logout additionally requires `Authorization: Bearer <access-JWT>`. Use `HttpOnly; Secure; SameSite=Lax` on the 7-day refresh cookie and a JavaScript-readable, Secure, SameSite=Lax `XSRF-TOKEN` cookie.
- Validate OAuth `state`; use a short-lived, one-time handoff code for token delivery.
- Do not log passwords, password hashes, access JWTs, refresh tokens, CSRF tokens, provider access tokens, or handoff codes.
- Accept only HS256 JWTs with a valid HMAC signature and required `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `sid`, and `token-type=access` claims; reject unsigned/unsupported algorithms, invalid signatures, expired tokens, invalid claims, and any otherwise-valid token containing `role`. Server-issued JWTs never contain `role`.
- Do not treat localStorage product data as trusted or server-authoritative.

## 9. Acceptance criteria

- Local sign-up/sign-in and OAuth exchange issue a 10-minute signed three-part JWS access token and set a 7-day opaque refresh-token cookie.
- Refresh-token rotation updates Redis atomically and preserves the session `sid`; Redis maps refresh-token hashes to the session and revokes the token family on reuse. The session denylist stores `sid` entries through the latest access-token `exp`.
- Logout revokes the refresh-token family and deny-lists its `sid`, so all access JWTs in that session are rejected; the logout request includes the access JWT, refresh cookie, and CSRF proof. Admin account lock applies the same revocation to every active `sid` for that account.
- The UI explains Base64URL encoding and that JWT payloads are not encrypted.
- Protected requests use `Authorization: Bearer <JWT>`; missing/invalid/expired JWTs are rejected.
- Google/Facebook OAuth validates state and returns only a one-time handoff code to the frontend; exchange returns the app JWT.
- Product add/hide changes persist locally after a successful backend acknowledgement and do not imply server-side persistence.
- Refresh and logout enforce session-bound CSRF validation using a `SecureRandom` token stored by hash in Redis and matched from `XSRF-TOKEN`/`X-CSRF-TOKEN`; the CSRF token is not signed. Logout also requires a Bearer access JWT. Bearer business endpoints do not require CSRF tokens.

## 10. Implementation decisions

- Local issuer/audience are fixed to `http://localhost:8080` and `http://localhost:3000`. Signing-key rotation is out of scope; the provisioned HS256 key remains fixed across logins and restarts.
- Admin-lock endpoint, admin authentication/authorization, account-unlock behavior, and persistence guarantees for lock state.
- Whether to impose an absolute maximum session-family lifetime in addition to each refresh token's 7-day lifetime.
- Cookie domain/path details and CORS credentials settings for the deployment topology.
- OAuth uses same-tab callback. Popup remains a possible future UX change and would require exact-origin `postMessage` validation.
- OAuth state and handoff-code hashes are stored in local Redis with TTL and atomic single-use consumption; Spring Security `HttpSession` is not used for this flow.
- Exact local UI technology and product fields.
