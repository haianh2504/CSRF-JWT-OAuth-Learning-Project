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

- CSRF tokens/protection.
- Database-backed accounts or products, real inventory, cart, checkout, or payment.
- JWT stored in cookies, `localStorage`, or `sessionStorage`.
- Production deployment, refresh-token flow, and production-grade JWT revocation.

## 4. Authentication and token design

- Authentication uses JWT-only bearer requests; no authentication/session cookie is used.
- After local sign-in or OAuth exchange, backend returns a signed compact JWS in JSON. The signing algorithm/key policy will be selected during implementation.
- The JWT has three Base64URL-encoded segments: header, payload, signature. Base64URL encoding is not encryption; claims must not contain secrets.
- The frontend keeps the JWT in memory and explicitly sends `Authorization: Bearer <JWT>` on protected API requests.
- Sign-up/sign-in and OAuth exchange are pre-authentication endpoints and cannot require an application JWT.
- OAuth `state`, provider authorization code, application handoff code, application JWT, and provider access token are separate values.

## 5. Mock data and persistence

- Demo accounts are held in memory and reset when the backend restarts. Passwords are hashed with Spring Security `BCryptPasswordEncoder`.
- The backend returns a fixed mock catalog and does not persist product changes.
- After a successful `POST /api/v1/products`, the frontend saves the product in `localStorage`.
- After a successful `DELETE /api/v1/products/{productId}`, the frontend saves the ID as hidden and filters the product out. This is local soft-hide, not server deletion.
- On page load, the frontend merges the fixed catalog with local additions and filters hidden IDs.
- JWT is kept in memory only; do not persist authentication tokens in browser storage.

## 6. Main flows

### Sign-up/sign-in

A visitor signs up with email/password. The backend stores an in-memory account with a BCrypt password hash. Sign-in returns a backend-issued JWS and user summary.

### OAuth

1. The browser opens the backend OAuth authorization route.
2. Backend redirects to Google or Facebook.
3. Provider returns an authorization code and state to the backend callback.
4. Backend validates state, exchanges the provider code server-to-server, and resolves the application account.
5. Backend creates a short-lived, single-use application handoff code.
6. Frontend callback receives the handoff code and calls `POST /api/v1/auth/oauth/exchange`.
7. Backend consumes the code once and returns the application's JWT in JSON.

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
- FR-11: Logout clears the JWT from client memory.
- FR-12: Validate request fields and return safe error responses.

## 8. Security requirements

- Hash passwords with Spring Security `BCryptPasswordEncoder`; never store plaintext passwords.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis. Use environment configuration locally and a secret manager/KMS in deployed environments.
- Validate OAuth `state`; use a short-lived, one-time handoff code for token delivery.
- Do not log passwords, password hashes, JWTs, provider access tokens, or handoff codes.
- Reject unsigned JWTs, unsupported algorithms, invalid signatures, expired tokens, and invalid issuer/audience claims.
- Do not treat localStorage product data as trusted or server-authoritative.

## 9. Acceptance criteria

- Local sign-up/sign-in works and returns a signed three-part JWS.
- The UI explains Base64URL encoding and that JWT payloads are not encrypted.
- Protected requests use `Authorization: Bearer <JWT>`; missing/invalid/expired JWTs are rejected.
- Google/Facebook OAuth validates state and returns only a one-time handoff code to the frontend; exchange returns the app JWT.
- Product add/hide changes persist locally after a successful backend acknowledgement and do not imply server-side persistence.
- No CSRF token endpoint, CSRF header, or CSRF enforcement remains in the project.

## 10. Implementation decisions

- JWT signing algorithm, issuer, audience, key rotation, and expiry.
- OAuth popup versus same-tab callback UX.
- Whether OAuth's transient authorization state may use Spring Security's default HttpSession or requires a custom repository.
- In-memory TTL storage versus Redis for OAuth handoff codes.
- Exact local UI technology and product fields.
