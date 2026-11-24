# Use Cases — CSRF_JWT_OAuth Shop

## 1. Actors

- **Visitor:** a user who is not signed in.
- **Authenticated user:** a user signed in with email/password or an OAuth provider.
- **Application:** the Spring Boot application and Spring Security.
- **OAuth provider:** Google or Facebook.

## 2. Authentication and persistence rules

- The application uses JWT-only authentication. The backend issues the JWT; the client keeps it in memory and sends `Authorization: Bearer <JWT>` on protected requests.
- The application does not use session cookies. JWT is not stored in a cookie, `localStorage`, or `sessionStorage`; `HttpOnly` does not apply to this bearer-header design.
- Authenticated state-changing requests require both bearer JWT and `X-CSRF-TOKEN` by project policy. This is additional validation in a bearer-only architecture, not protection against automatically sent authentication cookies. The server must bind/validate the CSRF token against the authenticated JWT/login context.
- OAuth `state`, the educational CSRF token, the application JWT, and provider access tokens are distinct values. OAuth sign-in results in the application's own JWT.
- Demo accounts are held in memory and reset when the backend restarts; passwords are still hashed. No database is used.
- Product data is mock data. The backend does not persist product changes.
- After a successful add request, the frontend stores the product in `localStorage`. After a successful hide request, the frontend stores its ID in a hidden-ID list. Hiding is local soft-hide behavior, not a database delete.

## 3. Endpoint map

| Use case | Method and endpoint | Purpose |
|---|---|---|
| UC-01 | `POST /api/v1/csrf-token` | Issue a pre-authentication CSRF token for sign-up/sign-in and UI learning. |
| UC-02 | `POST /api/v1/auth/signup` | Create an application account with email and password. |
| UC-03 | `POST /api/v1/auth/signin` | Authenticate with email and password; issue a JWT and an associated CSRF token. |
| UC-04 | `GET /oauth2/authorization/google` | Start Google OAuth login using Spring Security's conventional route. |
| UC-04 callback | `GET /login/oauth2/code/google` | Backend callback; validates state/code and creates a one-time handoff code. |
| UC-04 exchange | `POST /api/v1/auth/oauth/exchange` | Exchange Google OAuth handoff code for app JWT + authenticated CSRF token. |
| UC-05 | `GET /oauth2/authorization/facebook` | Start Facebook OAuth login using Spring Security's conventional route. |
| UC-05 callback | `GET /login/oauth2/code/facebook` | Backend callback; validates state/code and creates a one-time handoff code. |
| UC-05 exchange | `POST /api/v1/auth/oauth/exchange` | Exchange Facebook OAuth handoff code for app JWT + authenticated CSRF token. |
| UC-06 | `GET /api/v1/homepage` | Return authenticated shop home data. |
| UC-06 | `GET /api/v1/products` | Return the fixed mock catalog. |
| UC-07 | `POST /api/v1/products` | Add-product demo operation; requires bearer JWT and CSRF header; does not persist on the server. |
| UC-08 | `DELETE /api/v1/products/{productId}` | Hide-product demo operation; requires bearer JWT and CSRF header; does not delete from a database. |
| UC-09 | Uses UC-07 and UC-08 endpoints plus the CSRF token endpoint | Inspect the combined JWT + CSRF headers on protected writes. |
| UC-10 | `DELETE /api/v1/auth/sessions` | Clear the client-held JWT; include CSRF header; revocation is not provided unless added explicitly. |

OAuth start/callback routes use Spring Security conventions and are browser redirects, not custom `/api/v1` JSON endpoints. The callback redirects to the frontend with a short-lived, single-use application handoff code (never JWT/CSRF in the URL). The frontend callback sends the code to `POST /api/v1/auth/oauth/exchange` with its pre-auth CSRF header. On successful redemption, the backend returns the app JWT and a CSRF token bound to that login. Confirm popup versus same-tab UX and callback URLs during implementation.

`POST /api/v1/csrf-token` is the selected CSRF bootstrap endpoint. Because a client does not yet have a token on the first call, document how this endpoint is initialized/protected (for example, exempting this bootstrap endpoint from CSRF validation). It returns the token in a documented response. The client sends it in `X-CSRF-TOKEN` on state-changing requests. Sign-up/sign-in use the pre-auth token because no JWT exists yet. Authenticated product writes require both the JWT and its associated CSRF token.

Product endpoints validate bearer JWT authentication and return mock acknowledgements. They do not store product records. The frontend updates localStorage only after a successful response.

## UC-01 — Obtain a CSRF token

**Actor:** Visitor or authenticated user  
**Endpoint:** `POST /api/v1/csrf-token`  
**Goal:** Obtain a CSRF token for the educational token/header demonstration.

### Main flow
1. The client calls `POST /api/v1/csrf-token`.
2. The application returns a CSRF token for display and header demonstration; no session cookie is created.
3. The response returns the token in the documented format, such as a JSON field.
4. The UI displays the token and explains that it is additionally required by this project on state-changing requests. Since the app has no automatically sent auth cookie, this is stricter request validation rather than mitigation for classic cookie-based CSRF.

### Exceptions
- If initialization fails, the UI reports that it could not obtain a token.
- The bootstrap endpoint must have an explicit CSRF bootstrap policy because the client does not yet possess the token.
- The UI must not confuse this value with OAuth `state` or a JWT.

## UC-02 — Sign up with email and password

**Actor:** Visitor  
**Endpoint:** `POST /api/v1/auth/signup`  
**Goal:** Create an application account.

### Preconditions
- The visitor is not signed in.

### Main flow
1. The visitor opens the sign-up form and enters email/password.
2. The client submits the form to `POST /api/v1/auth/signup`.
3. The application validates the input, checks that the email is available, hashes the password, and creates the account.
4. The application confirms registration and directs the visitor to sign in.

### Exceptions
- Invalid email, duplicate email, or password policy failure: show a clear validation message.
- Server error: show a general error without exposing sensitive details.

## UC-03 — Sign in with email and password

**Actor:** Visitor  
**Endpoint:** `POST /api/v1/auth/signin`  
**Goal:** Authenticate with a local application account.

### Preconditions
- The visitor has a registered account.

### Main flow
1. The visitor submits email/password to `POST /api/v1/auth/signin`.
2. The application verifies the password against its hash.
3. The backend returns a signed JWT; the client keeps it in memory and uses it in the Authorization header.
5. The UI opens the shop home page.

### Exceptions
- Missing fields or incorrect credentials: show validation or a general authentication failure.
- A page refresh may clear the in-memory JWT and require another sign-in.

## UC-04 — Sign in with Google OAuth

**Actors:** Visitor, Google, Application  
**Start endpoint:** `GET /oauth2/authorization/google`  
**Callback endpoint:** `GET /login/oauth2/code/google`  
**Goal:** Sign in using a Google identity.

### Preconditions
- Google OAuth client credentials are configured.

### Main flow
1. The visitor selects “Continue with Google”.
2. The browser navigates to the authorization endpoint.
3. Spring Security starts the authorization request and validates OAuth `state` on callback.
4. The visitor authenticates with Google and grants the requested permissions.
5. Google redirects to the callback endpoint.
6. The application reads permitted claims, finds or provisions the linked application account, and establishes application authentication.
7. The UI opens the shop and displays Google and permitted profile details.

### Exceptions
- Consent denied, invalid callback/state, missing required claims, provider error, or missing configuration: keep the visitor signed out and show an appropriate message.

## UC-05 — Sign in with Facebook OAuth

**Actors:** Visitor, Facebook, Application  
**Start endpoint:** `GET /oauth2/authorization/facebook`  
**Callback endpoint:** `GET /login/oauth2/code/facebook`  
**Goal:** Sign in using a Facebook identity.

### Preconditions
- Facebook OAuth client credentials are configured.

### Main flow
1. The visitor selects “Continue with Facebook”.
2. The browser navigates to the authorization endpoint.
3. Spring Security starts the authorization request and validates OAuth `state` on callback.
4. The visitor authenticates with Facebook and grants the requested permissions.
5. Facebook redirects to the callback endpoint.
6. The application finds or provisions the linked application account and establishes authentication.
7. The UI opens the shop and displays Facebook and permitted profile details.

### Exceptions
- Consent denied, invalid callback/state, provider error, or missing configuration: keep the visitor signed out and show an appropriate message.

## UC-06 — View the shop and mock catalog

**Actor:** Authenticated user  
**Endpoints:** `GET /api/v1/homepage`, `GET /api/v1/products`  
**Goal:** Browse mock products and see the authenticated identity.

### Main flow
1. The user opens the shop home page.
2. The client calls the homepage and product endpoints using `Authorization: Bearer <JWT>`.
3. The backend returns home information and a fixed mock catalog; no database is queried.
4. The frontend reads locally added products and hidden product IDs from `localStorage`.
5. The UI merges the base mock catalog with local additions and filters out hidden products.
6. The shop displays product cards, add/hide controls, auth mode, and provider identity when applicable.

### Exceptions
- Unauthenticated or expired credential: return to sign-in or return 401/403.
- Invalid localStorage data: ignore/reset invalid product state and continue with the mock catalog.

## UC-07 — Add a product using bearer JWT authentication

**Actor:** Authenticated user  
**Endpoint:** `POST /api/v1/products`  
**Goal:** Add a mock product while observing backend JWT authentication and request headers.

### Main flow
1. The user fills in the add-product form.
2. The frontend creates a client-side product ID and submits the product to `POST /api/v1/products`.
3. The client sends `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN: <token>`.
4. The backend validates the JWT and verifies that the CSRF token is associated with the authenticated login context.
5. The backend returns an accepted demo response without persisting the product.
6. Only after success, the frontend stores the product in `localStorage` and renders it in the shop.
7. The Request Inspector displays the request and response with secrets appropriately masked or labeled as learning-only.

### Alternate/exception flows
- Missing/invalid JWT: return 401.
- A missing or invalid CSRF header rejects the authenticated state-changing request.
- Invalid product fields: return validation errors; do not update localStorage.
- localStorage unavailable/full: show a persistence error; the backend still has not stored the product.

## UC-08 — Hide a product using bearer JWT authentication

**Actor:** Authenticated user  
**Endpoint:** `DELETE /api/v1/products/{productId}`  
**Goal:** Hide a mock product while observing backend authentication and request headers.

### Main flow
1. The user selects Hide on a product.
2. The frontend sends `DELETE /api/v1/products/{productId}` with both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN: <token>`.
3. The backend validates the JWT and associated CSRF token, then returns a demo acknowledgement without database deletion.
4. Only after success, the frontend adds the product ID to the hidden-ID collection in `localStorage`.
5. The UI removes the product from the visible list.

### Alternate/exception flows
- Missing/invalid JWT or CSRF token: reject and leave localStorage unchanged.
- Product ID is unknown: return a suitable response; the UI does not hide it unless the operation is accepted.
- localStorage update fails: show an error; no server-side product state exists to reconcile.

## UC-09 — Inspect JWT requests and the CSRF token/header demonstration

**Actor:** Learner  
**Endpoints:** Product endpoints from UC-07/UC-08 and `POST /api/v1/csrf-token`  
**Goal:** Observe the actual bearer JWT request and separately learn what a CSRF token/header looks like.

### Main flow
1. The learner signs in and receives a backend-issued JWT.
2. The Request Inspector sends a product operation with `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN: <token>`.
3. The backend validates the JWT and returns a mock response.
4. The UI displays the Authorization header and response, with the token clearly labeled as a local learning value.
5. The learner obtains a CSRF token and observes the client attaching `X-CSRF-TOKEN` alongside the JWT on every authenticated state-changing request.
6. The backend rejects the request if either value is missing, invalid, or the CSRF token is not associated with that JWT/login context.

### Expected understanding
- JWT is the actual authentication credential for protected shop APIs.
- The client explicitly sends the JWT in the Authorization header.
- Authenticated state-changing requests require both credentials by project policy; the CSRF token is validated and associated with the JWT/login context.

## UC-10 — Log out

**Actor:** Authenticated user  
**Endpoint:** `DELETE /api/v1/auth/sessions`  
**Goal:** End the current authenticated experience.

### Main flow
1. The user selects Logout.
2. The client calls the logout endpoint with `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN: <token>`.
3. The application returns the logout acknowledgement; no session cookie is invalidated.
4. The client clears the in-memory JWT and returns to sign-in.
5. Product localStorage remains, so the shop state is available after a later sign-in in the same browser.

### Limitation
A stateless JWT may remain valid until expiration unless a server-side revocation strategy is implemented. Clearing the client copy alone does not revoke it.
