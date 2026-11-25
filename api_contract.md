# API Contract — JWT OAuth Mock Shop

## 1. Purpose and conventions

This contract defines the Spring Boot API for the mock shop. The initial backend has no relational database: a process-local in-memory user store holds demo accounts, Redis holds refresh-token hashes/session state, and the fixed product catalog is mock data. Product add/hide requests are acknowledged but not persisted by the backend; frontend persists local additions and hidden IDs.

The user store is a singleton backend service backed by an in-memory map (for example, `ConcurrentHashMap`), keyed by normalized email; OAuth identities are associated by provider and stable provider subject. It stores only account ID, normalized email, BCrypt password hash for password accounts, and OAuth identity mapping. It is available across requests in one process, but is cleared on restart and is not shared by multiple backend instances. `localStorage` is reserved for frontend product state and is not used for accounts or authentication.

- Base path: `/api/v1`
- JSON content type: `application/json; charset=utf-8`; OAuth routes are redirects/callbacks and not JSON APIs.
- JSON keys use `camelCase`; dates use ISO 8601 UTC.
- Every JSON API response uses the envelope in section 2.
- JWT authentication uses signed compact JWS, with three Base64URL-encoded parts: `header.payload.signature`. Payload is not encrypted.
- Access JWTs have a 10-minute lifetime and are kept in JavaScript memory only. Protected business endpoints require `Authorization: Bearer <access-JWT>`, except signup/signin, OAuth handoff exchange, and refresh.
- Sign-in and OAuth exchange return an access JWT and set a 7-day opaque refresh-token cookie with `HttpOnly; Secure; SameSite=Lax`. Refresh/logout use that cookie and require signed, session-bound Double Submit Cookie validation (`XSRF-TOKEN` cookie copied to `X-CSRF-TOKEN` header). This CSRF validation applies only to refresh and logout, not Bearer-authenticated business endpoints.
- Refresh tokens are high-entropy random opaque strings encoded as unpadded Base64URL. Redis stores only SHA-256 hashes and session/token-family metadata, never raw refresh tokens. SHA-256 is hashing, not encryption.
- Refresh rotation is atomic: a valid current token is consumed once and replaced; reuse of a consumed token revokes the associated token family/session.
- The access JWT signing algorithm, issuer, audience, and key rotation policy must be selected during implementation; its lifetime is fixed at 10 minutes. Reject unsigned or unsupported algorithms.
- Store signing keys in local environment configuration and a secret manager/KMS in deployed environments; never in Git or Redis.
- OAuth handoff state and refresh-token state must use TTL and atomic consumption/rotation when shared across instances. Refresh verification fails closed when Redis is unavailable.
- The catalog is small and fixed: no pagination fields.

## 2. Standard JSON envelope

Success and error JSON responses use:

```json
{
  "code": "OK",
  "message": "Request completed.",
  "data": {}
}
```

`code`, `message`, and `data` are required. Use stable application codes; clients must not parse `message`. Keep it compact: no duplicate `success`/HTTP status, empty metadata, or pagination fields.

Validation error:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request contains invalid fields.",
  "data": {
    "fieldErrors": {
      "email": "Enter a valid email address."
    }
  }
}
```

If there are no details, `data` is `null`. Never expose passwords, hashes, signing material, provider raw errors, or token values in errors.

## 3. Status codes

| HTTP | Code examples | Meaning |
|---:|---|---|
| 200 | `OK` | Successful read or action with body. |
| 201 | `CREATED` | Signup or accepted mock product add. |
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` | Malformed/invalid input. |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN` | Missing/invalid credentials. |
| 403 | `FORBIDDEN` | Authenticated but disallowed, if applicable. |
| 404 | `NOT_FOUND` | Unknown route/resource. |
| 409 | `EMAIL_ALREADY_REGISTERED` | Duplicate in-memory account. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported content type. |
| 500 | `INTERNAL_ERROR` | Generic unexpected server error. |

HTTP status and envelope code must agree. Do not return 200 for errors. JSON APIs return an envelope rather than 204.

## 4. JWT bearer contract

After authentication, the backend issues a signed JWT. The frontend keeps it in memory and sends:

```http
Authorization: Bearer <jwt>
```

The 10-minute access JWT is kept in JavaScript memory and sent in the Authorization header; it is not stored in cookies, `localStorage`, or `sessionStorage`. A JWS signature provides integrity/authenticity, not confidentiality; claims are readable. Do not include secrets in payload. Validate signature, allowed algorithm, expiration, issuer/audience, subject, and required claims. The separate 7-day opaque refresh token is set as an `HttpOnly; Secure; SameSite=Lax` cookie and is never returned in JSON. Only refresh and logout require CSRF validation: backend sets a JavaScript-readable `XSRF-TOKEN` cookie bound to the refresh-token session, frontend copies its value into `X-CSRF-TOKEN`, and backend verifies the signature/session binding and cookie/header match. Other business endpoints do not require CSRF tokens. An access JWT may remain usable for up to 10 minutes from issuance after logout; refresh is revoked immediately.

## 5. Endpoints

### 5.1 Sign up

`POST /api/v1/auth/signup`

No JWT required. Creates a demo account in the process-local in-memory user store; the store is shared by requests handled by this backend process and is lost on restart. Normalize email consistently before uniqueness checks and lookup. Password uses Spring Security `BCryptPasswordEncoder`; store only the resulting hash, never the submitted password.

Request:

```json
{
  "email": "learner@example.test",
  "password": "example-password"
}
```

Success: `201 Created`

```json
{
  "code": "CREATED",
  "message": "Account created. Please sign in.",
  "data": {
    "user": {
      "id": "usr_demo_01",
      "email": "learner@example.test"
    }
  }
}
```

Errors: 400 `VALIDATION_ERROR`, 409 `EMAIL_ALREADY_REGISTERED`. Never return raw password/hash or retain raw password after request processing.

### 5.2 Sign in

`POST /api/v1/auth/signin`

No JWT required. Request:

```json
{
  "email": "learner@example.test",
  "password": "example-password"
}
```

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed in.",
  "data": {
    "accessToken": "<10-minute-signed-application-jwt>",
    "tokenType": "Bearer",
    "expiresAt": "2026-11-25T12:00:00Z",
    "user": {
      "id": "usr_demo_01",
      "email": "learner@example.test",
      "loginMethod": "PASSWORD",
      "provider": null
    }
  }
}
```

Client holds `accessToken` in memory. Response sets the opaque 7-day refresh token as an `HttpOnly; Secure; SameSite=Lax` cookie and issues the bound `XSRF-TOKEN` cookie; do not include the refresh token in JSON. Errors: 400 validation, 401 generic `INVALID_CREDENTIALS`. Never return password or hash.

### 5.3 OAuth start and callback

OAuth browser routes are not JSON envelope endpoints:

- Google: `GET /oauth2/authorization/google`; callback `GET /login/oauth2/code/google`
- Facebook: `GET /oauth2/authorization/facebook`; callback `GET /login/oauth2/code/facebook`

The backend validates OAuth `state`, exchanges the provider authorization code server-to-server, and resolves the application user. Provider authorization code is never sent to frontend. Backend creates a random, short-lived, single-use application handoff code and redirects to an allowlisted frontend callback carrying only that code, never the app JWT.

For popup UX, callback page sends the handoff code to opener with `postMessage` using exact configured origin; opener validates `event.origin` and `event.source`, then calls exchange. Same-tab callback may exchange directly. Use `Cache-Control: no-store`, restrictive `Referrer-Policy`, no third-party resources, and remove the code from browser history as soon as practical.

Spring Security's default OAuth authorization request repository uses `HttpSession`; decide whether an OAuth-only transient session is allowed or configure a secure alternative preserving state/browser binding. Do not disable OAuth state validation.

### 5.4 Exchange OAuth handoff code

`POST /api/v1/auth/oauth/exchange`

No app JWT yet. Request:

```json
{
  "code": "<short-lived-one-time-app-handoff-code>"
}
```

Code must be high entropy, expire quickly, be tied to the completed provider transaction/user, and be atomically consumed once. Expired, replayed, mismatched, or malformed codes fail without issuing a JWT.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "OAuth sign-in completed.",
  "data": {
    "accessToken": "<10-minute-signed-application-jwt>",
    "tokenType": "Bearer",
    "expiresAt": "2026-11-25T12:00:00Z",
    "user": {
      "id": "usr_demo_oauth_01",
      "email": "learner@example.test",
      "loginMethod": "GOOGLE",
      "provider": "google"
    }
  }
}
```

Response also sets the opaque 7-day refresh token as an `HttpOnly; Secure; SameSite=Lax` cookie and issues the bound `XSRF-TOKEN` cookie; never return it in JSON. Errors: 400 `BAD_REQUEST` for invalid/expired/replayed code; 401 `UNAUTHENTICATED` for invalid exchange credential, using a generic policy that does not disclose code validity.

### 5.5 Refresh access token

`POST /api/v1/auth/refresh`

No access JWT required. Browser sends the refresh-token cookie, the `XSRF-TOKEN` cookie, and `X-CSRF-TOKEN` header. The backend requires the CSRF cookie/header values to match and verifies the signed token is bound to the refresh session. This is required only for refresh and logout. Refresh token is opaque high-entropy random data encoded as unpadded Base64URL, is not a JWT, and has a 7-day lifetime.

The backend computes SHA-256 over the exact presented Base64URL token string and looks up the hash in Redis. Redis stores the token hash, session/token-family state, and expiry only. In one atomic operation, the backend verifies that the token is current and unconsumed, marks it consumed, and stores the replacement token hash. A successful response returns a new 10-minute access JWT and sets a new refresh-token cookie with a fresh 7-day lifetime. Never return the refresh token in JSON or write it to logs.

If a consumed token is presented again, revoke the whole token family/session and require sign-in. Unknown, expired, revoked, or reused refresh tokens return 401 without issuing tokens; invalid CSRF proof returns 403. If Redis is unavailable, fail closed with a service error and issue no tokens. The active refresh-token Redis entry and refresh cookie have a 7-day TTL (604800 seconds); retain consumed-token markers for the configured session-family policy so reuse can be detected. Add `Cache-Control: no-store` headers.

Success: `200 OK` with the normal envelope containing `accessToken`, `tokenType`, `expiresAt`, and safe user summary; response also sets the rotated cookie.

### 5.6 Homepage

`GET /api/v1/homepage`

Authentication: bearer access JWT.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Homepage loaded.",
  "data": {
    "user": {
      "id": "usr_demo_01",
      "email": "learner@example.test",
      "loginMethod": "GOOGLE",
      "provider": "google"
    },
    "shopName": "Demo Shop"
  }
}
```

Errors: 401 invalid/missing JWT; 403 only if authorization policy requires it.

### 5.7 List mock products

`GET /api/v1/products`

Authentication: bearer access JWT.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Products loaded.",
  "data": {
    "products": [
      {
        "id": "prd_demo_01",
        "name": "Canvas Tote Bag",
        "description": "Reusable everyday tote.",
        "price": 12.5,
        "currency": "USD",
        "imageUrl": null
      }
    ]
  }
}
```

Fixed, small catalog; no `page`, `size`, `totalElements`, or pagination links. Client merges local additions and filters hidden IDs.

### 5.8 Add mock product

`POST /api/v1/products`

Authentication: bearer JWT.

Request:

```json
{
  "id": "prd_local_a1b2",
  "name": "Ceramic Mug",
  "description": "A mock product added in the shop UI.",
  "price": 9.5,
  "currency": "USD",
  "imageUrl": null
}
```

Backend validates JWT/body and acknowledges; it does not save product. Success: `201 Created`, envelope contains accepted product. Frontend stores it in `localStorage` only after success.

Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` if applicable.

### 5.9 Hide mock product

`DELETE /api/v1/products/{productId}`

Authentication: bearer JWT. No body. Backend acknowledges but does not delete server-side record.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Product hide accepted.",
  "data": {
    "productId": "prd_demo_01",
    "hidden": true
  }
}
```

After success frontend stores ID in local hidden list and filters it out. Errors: 400 malformed ID, 401 missing/invalid JWT, 403 if applicable.

### 5.10 Inspect authentication context

`GET /api/v1/auth/sessions`

Authentication: bearer JWT. Read-only; no mutation.

Success: envelope with safe user summary, `authMode: "JWT"`, and access-token expiry. Never include JWT, refresh token/hash, provider access token, signing material, or session ID.

### 5.11 Logout

`DELETE /api/v1/auth/sessions`

Authentication: current refresh-token cookie; require CSRF/origin validation. A valid access JWT is not required to revoke the current refresh-token session.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed out.",
  "data": null
}
```

Backend revokes the current refresh-token family/session in Redis and expires both refresh and CSRF cookies. Frontend clears the in-memory access JWT. Already-issued access JWTs may remain valid for up to 10 minutes from issuance; this endpoint does not imply immediate access-JWT revocation. Product localStorage is not cleared by logout.

## 6. Common errors

Unauthenticated (`401`):

```json
{"code":"UNAUTHENTICATED","message":"Authentication is required.","data":null}
```

Invalid fields (`400`):

```json
{"code":"VALIDATION_ERROR","message":"The request contains invalid fields.","data":{"fieldErrors":{"price":"Must be zero or greater."}}}
```

## 7. Data rules

Product: opaque ID; name 1–100 chars; description optional up to 500 chars; finite non-negative price; 3-letter uppercase currency; `imageUrl` absolute safe URL or `null`.

User summary exposes only ID, email, login method, provider. Never expose password/hash, raw provider claims beyond allowed profile fields, provider access token, or signing key.
