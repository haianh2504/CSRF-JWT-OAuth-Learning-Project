# Use Cases — JWT OAuth Mock Shop

## 1. Actors and rules

- **Visitor:** not authenticated.
- **Authenticated user:** signed in through email/password or Google/Facebook OAuth.
- **Application:** Spring Boot and Spring Security backend with a minimal frontend.
- **Provider:** Google or Facebook.

The application uses signed JWT bearer authentication only. It has no authentication/session cookie and no CSRF token flow. The JWT is kept in client memory and sent as `Authorization: Bearer <JWT>`. JWT is a compact JWS with three Base64URL-encoded parts; the payload is not encrypted.

The backend has no database. Demo accounts exist in memory until restart; product mutations are acknowledged but not stored server-side. Frontend stores added products and hidden IDs in `localStorage`.

## 2. Endpoint map

| UC | Method and endpoint | Purpose |
|---|---|---|
| UC-01 | `POST /api/v1/auth/signup` | Create in-memory account with email/password. |
| UC-02 | `POST /api/v1/auth/signin` | Verify credentials and return signed app JWT. |
| UC-03 | `GET /oauth2/authorization/google` | Start Google OAuth. |
| UC-03 callback | `GET /login/oauth2/code/google` | Backend callback; validates state and creates one-time app handoff code. |
| UC-04 | `GET /oauth2/authorization/facebook` | Start Facebook OAuth. |
| UC-04 callback | `GET /login/oauth2/code/facebook` | Backend callback; validates state and creates one-time app handoff code. |
| UC-05 | `POST /api/v1/auth/oauth/exchange` | Exchange handoff code for app JWT. |
| UC-06 | `GET /api/v1/homepage` | Return authenticated shop information. |
| UC-06 | `GET /api/v1/products` | Return fixed mock catalog. |
| UC-07 | `POST /api/v1/products` | Acknowledge product add; backend does not persist. |
| UC-08 | `DELETE /api/v1/products/{productId}` | Acknowledge hide; backend does not delete a record. |
| UC-09 | `DELETE /api/v1/auth/sessions` | Logout acknowledgement; frontend clears JWT. |

All `/api/v1` protected endpoints require bearer JWT, except sign-up, sign-in, and OAuth handoff exchange which occur before an app JWT exists. OAuth routes use browser redirects and are not JSON envelope endpoints.

## UC-01 — Sign up with email/password

1. Visitor submits email and password to `POST /api/v1/auth/signup`.
2. Backend validates fields, checks uniqueness, hashes password using Spring Security `BCryptPasswordEncoder`, and stores the account in memory.
3. Backend returns a safe user summary, not a JWT or password/hash.
4. Visitor proceeds to sign in.

Errors: invalid fields (400), duplicate email (409), unexpected error (500 envelope). In-memory account is lost after backend restart.

## UC-02 — Sign in with email/password

1. Visitor submits credentials to `POST /api/v1/auth/signin`.
2. Backend verifies with `PasswordEncoder.matches`.
3. Backend returns signed compact JWS with token type `Bearer`, expiry, and safe user summary.
4. Frontend keeps JWT in memory and navigates to shop.

Invalid credentials return generic 401. No cookie is set. Reloading the page clears the in-memory token and requires sign-in again.

## UC-03/04 — Sign in through Google/Facebook

1. Frontend opens backend authorization route, preferably in a popup or same-tab flow.
2. Backend redirects to provider with OAuth state.
3. Provider authenticates user and redirects authorization code/state to the backend callback.
4. Backend validates state and exchanges provider code server-to-server; provider code is never sent to frontend.
5. Backend maps/provisions local account and creates short-lived, single-use application handoff code.
6. Callback redirects to a fixed frontend callback URL with only the handoff code.
7. Frontend redeems the code at `POST /api/v1/auth/oauth/exchange`.
8. Backend consumes code once and returns app JWT and user summary.
9. Frontend keeps JWT in memory and opens shop.

Reject denied consent, state mismatch/replay, invalid/expired code, provider mismatch, missing required claims, and unconfigured provider. JWT must never appear in callback URL. In popup mode use `postMessage` with exact-origin validation.

## UC-05 — Exchange OAuth handoff code

1. Frontend sends the short-lived handoff code to `POST /api/v1/auth/oauth/exchange`.
2. Backend verifies expiry, one-time state, provider/principal association, and consumes code atomically.
3. Backend issues signed app JWT and returns JSON envelope.
4. Replay/expired/malformed codes fail without issuing credentials.

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

1. Frontend sends `DELETE /api/v1/auth/sessions` with bearer JWT.
2. Backend returns logout acknowledgement; stateless JWT may remain valid until expiry unless revocation is added.
3. Frontend clears token from memory and returns to sign-in.
4. Product localStorage remains per project policy.
