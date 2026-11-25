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
- Production deployment and production-grade infrastructure beyond the documented Redis-backed refresh-token rotation/revocation flow.

## 4. Authentication and token design

- Protected business APIs use a backend-signed compact JWS JWT access token with a 10-minute lifetime. The frontend keeps it in JavaScript memory only and sends it as `Authorization: Bearer <access-token>`.
- Sign-up/sign-in and OAuth exchange are pre-authentication endpoints. Successful sign-in and OAuth exchange return an access JWT and set a refresh-token cookie.
- The refresh token is a high-entropy opaque random value encoded with unpadded Base64URL; it is not a JWT and carries no claims. Each token lives for 7 days and the browser stores it in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to authentication endpoints.
- Redis stores SHA-256 hashes of refresh tokens plus session/token-family metadata and expiry. Hashing is one-way, not encryption; raw refresh tokens and signing keys are never stored in Redis.
- `POST /api/v1/auth/refresh` atomically consumes the presented refresh token, issues a new access JWT and refresh token, and detects reuse of a consumed token. Reuse revokes the token family/session.
- Logout revokes the refresh-token session and clears its cookie. Already-issued access JWTs remain usable for up to 10 minutes from issuance; there is no access-token denylist in the selected design.
- The JWT has three Base64URL-encoded segments: header, payload, signature. Base64URL encoding is not encryption; claims must not contain secrets.
- Only refresh and logout require CSRF validation, using signed, session-bound Double Submit Cookie: the server issues a JavaScript-readable `XSRF-TOKEN` cookie and the frontend copies it to the `X-CSRF-TOKEN` header; the backend verifies cookie/header equality and session binding. Bearer-authenticated business API requests do not require CSRF tokens.
- OAuth `state`, provider authorization code, application handoff code, application JWT, and provider access token are separate values.

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
5. Backend creates a short-lived, single-use application handoff code.
6. Frontend callback receives the handoff code and calls `POST /api/v1/auth/oauth/exchange`.
7. Backend consumes the code once, returns a 10-minute access JWT in JSON, and sets a 7-day refresh-token cookie.

Provider authorization codes and application JWTs must not be placed in frontend redirect URLs. Popup mode uses `postMessage` with exact-origin validation; same-tab mode may be used instead.

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
- FR-11: Logout revokes the current refresh-token session in Redis, clears the refresh cookie, and clears the access JWT from client memory.
- FR-12: Validate request fields and return safe error responses.
- FR-13: Refresh an expired access JWT by rotating the opaque refresh token and issuing a new access JWT.
- FR-14: Detect reuse of a rotated refresh token and revoke the associated token family/session.

## 8. Security requirements

- Hash passwords with Spring Security `BCryptPasswordEncoder`; never store plaintext passwords.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis. Use environment configuration locally and a secret manager/KMS in deployed environments.
- Store only SHA-256 refresh-token hashes and session metadata in Redis; use TTL and atomic rotation/revocation. Fail closed if Redis cannot validate a refresh token.
- Protect only cookie-authenticated refresh/logout routes against CSRF with signed, session-bound Double Submit Cookie; use `HttpOnly; Secure; SameSite=Lax` on the 7-day refresh cookie and a JavaScript-readable, Secure, SameSite=Lax `XSRF-TOKEN` cookie.
- Validate OAuth `state`; use a short-lived, one-time handoff code for token delivery.
- Do not log passwords, password hashes, access JWTs, refresh tokens, CSRF tokens, provider access tokens, or handoff codes.
- Reject unsigned JWTs, unsupported algorithms, invalid signatures, expired tokens, and invalid issuer/audience claims.
- Do not treat localStorage product data as trusted or server-authoritative.

## 9. Acceptance criteria

- Local sign-up/sign-in and OAuth exchange issue a 10-minute signed three-part JWS access token and set a 7-day opaque refresh-token cookie.
- Refresh token rotation updates Redis atomically, stores only SHA-256 hashes, and revokes the token family on reuse.
- Logout revokes refresh capability; access JWTs are rejected after expiry and refresh-cookie state is removed.
- The UI explains Base64URL encoding and that JWT payloads are not encrypted.
- Protected requests use `Authorization: Bearer <JWT>`; missing/invalid/expired JWTs are rejected.
- Google/Facebook OAuth validates state and returns only a one-time handoff code to the frontend; exchange returns the app JWT.
- Product add/hide changes persist locally after a successful backend acknowledgement and do not imply server-side persistence.
- Only refresh/logout cookie endpoints enforce signed, session-bound Double Submit Cookie validation using `XSRF-TOKEN` and `X-CSRF-TOKEN`; Bearer business endpoints do not require CSRF tokens.

## 10. Implementation decisions

- JWT signing algorithm, issuer, audience, and key rotation.
- Whether to impose an absolute maximum session-family lifetime in addition to each refresh token's 7-day lifetime.
- Cookie domain/path details and CORS credentials settings for the deployment topology.
- OAuth popup versus same-tab callback UX.
- Whether OAuth's transient authorization state may use Spring Security's default HttpSession or requires a custom repository.
- In-memory TTL storage versus Redis for OAuth handoff codes.
- Exact local UI technology and product fields.
