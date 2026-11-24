# CSRF_JWT_OAuth

A small Spring Boot learning project with a mock shop UI. Users can sign up/sign in with email and password or use Google/Facebook OAuth, then view mock products, add products, and hide products while learning CSRF and JWT authentication.

There is no database. The backend validates protected demo requests and returns mock responses. The frontend persists accepted product additions and hidden product IDs in `localStorage`.

> This is a learning project. Displaying tokens in the UI is for local development and education only; it is not a production security pattern.

## Scope

- Email/password sign-up and sign-in.
- Continue with Google and Continue with Facebook.
- Authenticated shop home page with mock products.
- Add and hide product actions.
- Request Inspector for bearer JWT requests and a separate CSRF token/header learning panel.
- Logout.

See [PRD.md](PRD.md) for requirements and [use_case.md](use_case.md) for the user flows and endpoint map.

## Authentication model

- The backend issues the application JWT after sign-in. The client keeps it in memory and sends `Authorization: Bearer <JWT>` on protected API requests.
- This project does not use session cookies. The JWT is not stored in a cookie, `localStorage`, or `sessionStorage`.
- `HttpOnly` applies only to cookies, so it does not apply to the chosen bearer-header design.
- Authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN`. This is an intentional additional request-validation policy. Since the JWT is explicitly attached by client code and is not an automatically sent cookie, this is not needed for classic cookie-based CSRF protection; document the distinction. The backend must validate the CSRF token and bind it to the authenticated JWT/login context.
- OAuth `state`, the educational CSRF token, the application JWT, and provider access tokens are different values. OAuth login results in the application's own JWT.

## Product data and local persistence

- Demo accounts are kept in memory and reset when the backend restarts; no database is used. Passwords are hashed with Spring Security `BCryptPasswordEncoder` (one-way hashing, not encryption).
- The backend serves a fixed mock catalog; no database is used.
- After `POST /api/v1/products` succeeds, the frontend saves the new product in `localStorage`.
- After `DELETE /api/v1/products/{productId}` succeeds, the frontend records the product ID as hidden in `localStorage`; the UI filters it out. This is a soft hide, not a database delete.
- On reload, the frontend merges the mock catalog with local additions and filters hidden IDs.
- Clearing browser site data resets local product changes.
- Product records in `localStorage` are display state, not trusted server data. Authentication tokens are never stored there.

## Endpoint overview

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/csrf-token` | Issue a pre-authentication CSRF token used by sign-up/sign-in and displayed in the UI. |
| `POST` | `/api/v1/auth/signup` | Register with email/password. |
| `POST` | `/api/v1/auth/signin` | Sign in, return a backend-issued JWT and an associated CSRF token. |
| `GET` | `/api/v1/homepage` | Return the authenticated shop shell/home data. |
| `GET` | `/api/v1/products` | Return the fixed mock catalog. |
| `POST` | `/api/v1/products` | Validate and acknowledge a product addition; frontend persists it locally. |
| `DELETE` | `/api/v1/products/{productId}` | Validate and acknowledge a hide action; frontend stores the hidden ID locally. |
| `DELETE` | `/api/v1/auth/sessions` | Clear the client-held JWT; server-side revocation is not provided unless added explicitly. |

Product write endpoints require both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN`. Sign-up/sign-in and CSRF bootstrap are pre-authentication exceptions because no JWT exists yet; they use the pre-auth token where appropriate. OAuth uses Spring Security authorization and callback routes described in `use_case.md`. Provider authorization codes never go to the frontend; after callback validation, the backend returns only a short-lived handoff code through the callback flow.

## Planned technology

- Java 21 (confirm when scaffolding the project).
- Spring Boot and Spring Security.
- Spring Security OAuth2 Client.
- Maven.
- A minimal frontend served by Spring Boot or a separate frontend (to be decided).
- Fixed mock catalog in code; no database dependency for the initial project.

## Run locally

This section will be completed after the source project is created. The expected command is:

```bash
./mvnw spring-boot:run
```

Real Google/Facebook OAuth requires provider client credentials. Provide secrets through environment variables or local ignored configuration; never commit them.

## Suggested learning sequence

1. Build sign-up and sign-in; inspect `BCryptPasswordEncoder` password hashing and matching.
2. Implement CSRF token issuance and validation; require the token header with JWT on authenticated state-changing requests.
3. Add the mock shop catalog and protected add/hide endpoints.
4. Send product writes with both bearer JWT and CSRF header; observe rejection when either is missing or invalid.
5. Add JWT issuance/validation and send product writes with both `Authorization: Bearer <JWT>` and `X-CSRF-TOKEN`.
6. Persist product additions and hidden IDs in `localStorage`, keeping auth tokens in memory only.
7. Compare the two request modes in the Request Inspector.
8. Add Google and Facebook OAuth, implement the one-time handoff-code exchange, then complete logout and UI states.

## Security notes

- Hash passwords with Spring Security `BCryptPasswordEncoder`; never log passwords, password hashes, or tokens.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis; use environment configuration locally and a secret manager in deployed environments. Redis may hold expiring handoff/CSRF state, not signing keys.
- For this single-instance learning app, an in-memory TTL store is enough for CSRF associations and one-time OAuth handoff codes. Consider Redis only if you need shared state across instances or process restarts; use TTL and atomic one-time consumption.
- Display token values only in local/development learning mode.
- Do not treat localStorage contents as secure or server-authoritative.
- Do not use the learning configuration as a production security template.

## Documentation

- [PRD.md](PRD.md)
- [use_case.md](use_case.md)
