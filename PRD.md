# PRD — CSRF, JWT & OAuth Shop

## 1. Product overview

### Project name
CSRF_JWT_OAuth

### Purpose
Build a small Spring Boot learning application with a familiar shop interface. The project teaches email/password authentication, Google and Facebook OAuth login, CSRF protection, and backend-issued JWT authentication through basic product-management actions.

The shop is a UI and security learning demo, not a real commerce application. It has no database. The backend validates protected demo requests and returns mock responses; the browser persists product additions and hidden-product IDs in `localStorage`.

## 2. Goals

- Learn how a CSRF token value can be issued and sent in a header; explain the limits of CSRF protection in a bearer-only architecture.
- Learn how a backend issues and validates JWTs sent as `Authorization: Bearer <JWT>`.
- Use bearer JWT for protected product operations and inspect the CSRF token/header separately as an educational demonstration.
- Practice OAuth login with Google and Facebook and show which provider account was used.
- Demonstrate useful shop actions: view products, add a product, and hide a product.
- Persist shop UI state across page refreshes without a database.

## 3. Scope

### In scope

1. Email/password sign-up and sign-in.
2. “Continue with Google” and “Continue with Facebook” OAuth login.
3. An authenticated shop home page with mock products.
4. Add-product form and product cards/list.
5. Hide-product action. Hiding is a local soft-hide: the product is filtered out and its ID is saved locally; no backend/database deletion occurs.
6. Backend-protected product operations authenticated only with bearer JWT.
7. A learning panel that displays the CSRF token and explains the outgoing header, plus a JWT panel and request inspector.
8. Logout and unauthenticated states.

### Out of scope

- A real catalog, inventory, orders, cart, checkout, or payment flow.
- Database or server-side persistence of product additions/removals.
- Multiple roles, administration, email verification, and password reset.
- Production deployment or production-grade token revocation.
- Storing the JWT in a cookie, `localStorage`, or `sessionStorage` in the initial JWT flow.

## 4. Users

Learners studying Java, Spring Boot, and Spring Security who want to see authentication and CSRF behavior through familiar shop actions.

## 5. Authentication and data design

### JWT-only authentication

- The backend issues the application JWT after successful local or OAuth sign-in.
- The client keeps the JWT in memory and sends it explicitly as `Authorization: Bearer <JWT>` on protected API requests.
- The application does not use session cookies and does not store the JWT in a cookie, `localStorage`, or `sessionStorage`.
- `HttpOnly` is a cookie attribute and does not apply to this JWT transport.

### CSRF learning panel

The project requires both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN: <token>` on authenticated state-changing API requests (`POST`, `PUT`, `PATCH`, and `DELETE`). This is an intentional additional request-validation policy in the JWT-only design. Because the bearer JWT is not automatically attached by the browser, the CSRF token is not needed to mitigate classic cookie-based CSRF; the UI and docs must explain this distinction. The backend must validate the CSRF token and bind it to the authenticated JWT/login context (for example, its `jti` and expiry), rather than accepting any arbitrary random header value.

Sign-up/sign-in and the CSRF bootstrap happen before an authenticated JWT exists, so they cannot require a JWT. They must use the pre-authentication CSRF token where appropriate. OAuth callback routes are provider-controlled browser callbacks and need their own OAuth `state` validation.

### OAuth

OAuth `state`, the educational CSRF token, the application JWT, and a provider access token are distinct values. OAuth login results in the application's own JWT; provider access tokens are not used as application bearer tokens.

### Mock product persistence

- Registered demo accounts are kept in an in-memory store and reset when the backend restarts; no database is used. Passwords must be hashed with Spring Security `BCryptPasswordEncoder`; BCrypt is one-way password hashing, not encryption.
- The backend provides a fixed mock catalog for the initial shop view (hard-coded/in-memory; no database).
- After a successful `POST /api/v1/products`, the frontend stores the returned or submitted product in a local `localStorage` collection.
- After a successful `DELETE /api/v1/products/{productId}`, the frontend adds the product ID to a local hidden-ID collection. The UI filters it out; this is not a database delete.
- On page load, the UI combines the fixed mock catalog with locally added products and filters out hidden IDs.
- Product state persists across reloads in the same browser. Clearing site storage resets local additions and hidden IDs.
- Product data in `localStorage` is untrusted display state, not authoritative business data.
- JWT remains in client memory only; do not persist authentication tokens in `localStorage`.

The backend product endpoints validate both the bearer JWT and its associated CSRF token, then return demo responses. They do not save product changes.

## 6. Main flows

### Sign-up and sign-in
Users can create a local account with email/password and sign in. In JWT mode the backend returns a signed JWT, which stays in client memory. The application uses JWT-only authentication; there is no session-cookie login mode.

### OAuth login
A visitor starts Google or Facebook OAuth. Spring Security handles the authorization redirect and callback, associates the provider identity with an application account, and establishes the application's authenticated state. Provider account details shown in the shop are limited to permitted claims.

### Shop and product actions
1. An authenticated user opens the shop home page.
2. The UI loads mock catalog data and merges it with locally saved product additions and hidden IDs.
3. The user submits a product form. The UI sends `POST /api/v1/products` with the bearer JWT in the Authorization header.
4. After the backend accepts the request, the UI stores the product in `localStorage` and renders it.
5. The user chooses Hide on a product. The UI sends `DELETE /api/v1/products/{productId}` with the bearer JWT in the Authorization header.
6. After the backend accepts the request, the UI saves the ID as hidden and removes the product from the rendered list.

### Inspect JWT and CSRF concepts
The Request Inspector shows protected state-changing product requests with both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN`. The UI explains that the CSRF header is an additional request-validation policy in this JWT-only design.

## 7. Functional requirements

- FR-01: A visitor can sign up with email and password.
- FR-02: A registered user can sign in with email and password.
- FR-03: A visitor can start OAuth login with Google.
- FR-04: A visitor can start OAuth login with Facebook.
- FR-05: Successful OAuth login maps the provider identity to an application account and records the provider.
- FR-06: Only authenticated users can access the shop home page and protected product operations.
- FR-07: The shop displays a fixed mock catalog and locally persisted product state.
- FR-08: An authenticated user can add a product; the backend authorizes the demo request and the frontend saves the accepted product to `localStorage`.
- FR-09: An authenticated user can hide a product; the backend authorizes the demo request and the frontend saves the hidden ID to `localStorage`.
- FR-10: Product operations require bearer JWT authentication. The CSRF token/header is displayed as an educational demonstration, not as an active protection for these requests.
- FR-11: The UI displays the CSRF token and requires its header alongside the JWT for authenticated state-changing requests, while explaining why this is an additional policy in a bearer-only design.
- FR-12: The UI can display the request headers and response for product operations.
- FR-13: The backend issues a JWT; the client sends it as `Authorization: Bearer <JWT>` and keeps it in memory only.
- FR-14: The UI explains that `HttpOnly` only applies to cookies and is not applicable to the no-cookie JWT flow.
- FR-15: A user can log out and return to sign-in.
- FR-16: Forms validate inputs and show clear errors.

## 8. Non-functional and safety requirements

- Hash passwords with Spring Security `BCryptPasswordEncoder`; never store plaintext passwords. Verify passwords with the encoder rather than decrypting or comparing raw strings.
- Keep OAuth client secrets and JWT signing keys outside Git. Use environment configuration locally and a secret manager/KMS in deployed environments; do not store signing keys in Redis.
- Use an in-memory TTL store for CSRF associations and one-time OAuth handoff codes in the initial single-instance app. Redis is an optional later store for shared ephemeral state, with TTL and atomic one-time consumption.
- Validate OAuth callback `state`.
- Never log passwords, JWTs, provider access tokens, or CSRF secrets.
- Show tokens only in local/development learning mode with clear labels.
- Use mock product data; do not enter real personal data.
- Do not treat localStorage product state as secure or server-authoritative.
- Clearly distinguish the bearer JWT, educational CSRF header, OAuth `state`, and provider access token.

## 9. Shop home page content

- Shop header and authenticated user/provider identity.
- Product cards with mock name, description, price, and image placeholder.
- Add-product form with basic validation.
- Hide action for each product.
- CSRF learning panel: token, header name/example, and explanation that this header is not needed for bearer JWT requests.
- JWT learning panel: backend-issued JWT and bearer header example in JWT mode.
- Request Inspector showing outgoing request and backend response.
- Logout control.

## 10. Acceptance criteria

- A user can sign up and sign in with email/password.
- Google/Facebook OAuth can be configured and used; setup instructions explain the required provider credentials.
- Unauthenticated users cannot access the shop or protected product operations.
- The shop shows mock products without a database.
- Adding a product calls `POST /api/v1/products`; after success, the product persists across refresh in `localStorage`.
- Hiding a product calls `DELETE /api/v1/products/{productId}`; after success, it is hidden across refresh through a locally stored hidden ID, without database deletion.
- Product writes include both required headers and are rejected when either credential is missing or invalid.
- Product writes require both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN`; the backend rejects either missing or invalid credential.
- The UI explains the distinction between the two modes and shows the request/response details.
- JWT is not persisted in browser storage or a cookie.
- Logout clears the in-memory JWT and returns the UI to the unauthenticated state.

## 11. Decisions for implementation

- Whether the minimal UI will use Thymeleaf/static assets served by Spring Boot or a separate frontend.
- Exact mock catalog fields and product validation rules.
- Exact response shape for product demo endpoints; no response is persisted server-side.
- The flow that delivers the backend-issued JWT to the client after local and OAuth sign-in.
- Google/Facebook OAuth credentials and callback URLs. Secrets must not be committed.
