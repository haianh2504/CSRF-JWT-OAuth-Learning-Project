# CSRF_JWT_OAuth

A Spring Boot learning project with a mock shop UI. Users sign up/sign in with email/password or Google/Facebook OAuth, then browse mock products, add products, and hide products while learning signed JWT (JWS) bearer authentication.

There is no product database. The backend validates requests and returns mock responses. The frontend persists accepted additions and hidden product IDs in `localStorage`.

## Scope

- Email/password sign-up and sign-in.
- Google and Facebook OAuth.
- Authenticated shop page with a fixed mock catalog.
- Add and hide products.
- Request Inspector for bearer JWT requests.
- Logout.

See [PRD.md](PRD.md), [use_case.md](use_case.md), [api_contract.md](api_contract.md), and [testing_usecases.md](testing_usecases.md).

## JWT model

- Backend returns a signed JWT in compact JWS format: `header.payload.signature`.
- Each of the three parts is Base64URL-encoded. The payload is not encrypted.
- Client keeps the token in memory and sends `Authorization: Bearer <JWT>`.
- There is no authentication/session cookie. JWT is not stored in cookies or browser storage; `HttpOnly` does not apply.
- This project does not implement CSRF tokens or CSRF protection. Protected API requests use bearer JWT authentication.

## OAuth token handoff

OAuth provider authorization codes are handled server-to-server. After callback validation, the backend creates a short-lived, single-use application handoff code. The frontend exchanges it at `POST /api/v1/auth/oauth/exchange` to receive the app JWT. Do not place JWTs in redirect URLs.

## Mock product persistence

- Backend serves a fixed mock catalog; no database is used.
- After `POST /api/v1/products` succeeds, frontend stores the product in `localStorage`.
- After `DELETE /api/v1/products/{productId}` succeeds, frontend stores its ID as hidden and filters it out; this is a local soft-hide.
- On reload, frontend merges mock products with local additions and hidden IDs. Clearing browser storage resets local changes.
- Authentication tokens are never stored in localStorage/sessionStorage.

## Endpoint overview

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register with email/password. |
| `POST` | `/api/v1/auth/signin` | Sign in and receive backend JWT. |
| `GET` | `/oauth2/authorization/google` | Start Google OAuth. |
| `GET` | `/login/oauth2/code/google` | Google callback. |
| `GET` | `/oauth2/authorization/facebook` | Start Facebook OAuth. |
| `GET` | `/login/oauth2/code/facebook` | Facebook callback. |
| `POST` | `/api/v1/auth/oauth/exchange` | Exchange one-time OAuth handoff code for app JWT. |
| `GET` | `/api/v1/homepage` | Return authenticated shop data. |
| `GET` | `/api/v1/products` | Return fixed mock catalog. |
| `POST` | `/api/v1/products` | Validate/acknowledge product add; frontend persists locally. |
| `DELETE` | `/api/v1/products/{productId}` | Validate/acknowledge product hide; frontend persists locally. |
| `DELETE` | `/api/v1/auth/sessions` | Clear client-held JWT; server revocation is not provided unless added. |

## Planned technology

Java 21 (confirm when scaffolding), Spring Boot, Spring Security, Spring Security OAuth2 Client, Maven. Demo accounts are in memory and reset on backend restart. No database is used initially.

## Run locally

To be completed after creating source code. Expected command:

```bash
./mvnw spring-boot:run
```

OAuth requires Google/Facebook client credentials. Use environment configuration or ignored local config; never commit secrets.

## Security notes

- Use Spring Security `BCryptPasswordEncoder`; never log passwords or tokens.
- Keep OAuth client secrets and JWT signing keys out of Git and Redis. Use a secret manager/KMS for deployed environments.
- In-memory TTL storage is sufficient for one local backend instance. Redis is optional for shared OAuth handoff state across instances; use TTL and atomic one-time consumption. Never store signing keys in Redis.
- Do not treat localStorage product state as trusted or server-authoritative.
