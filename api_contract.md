# API Contract — JWT OAuth Mock Shop

## 1. Purpose and conventions

This contract defines the Spring Boot API for the mock shop. The backend has no database: demo accounts are in memory and fixed product catalog is mock data. Product add/hide requests are acknowledged but not persisted by the backend; frontend persists local additions and hidden IDs.

- Base path: `/api/v1`
- JSON content type: `application/json; charset=utf-8`; OAuth routes are redirects/callbacks and not JSON APIs.
- JSON keys use `camelCase`; dates use ISO 8601 UTC.
- Every JSON API response uses the envelope in section 2.
- JWT authentication uses signed compact JWS, with three Base64URL-encoded parts: `header.payload.signature`. Payload is not encrypted.
- Protected endpoints require `Authorization: Bearer <JWT>`, except signup/signin and OAuth handoff exchange.
- No CSRF token, CSRF header, authentication cookie, or session login is used.
- The signing algorithm, issuer, audience, expiry, and key rotation policy must be selected during implementation. Reject unsigned or unsupported algorithms.
- Store signing keys in local environment configuration and a secret manager/KMS in deployed environments; never in Git or Redis.
- Local single-instance handoff state can use in-memory TTL storage. Redis is optional for shared handoff state across multiple instances; set TTL and atomically consume one-time codes.
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

The JWT is not stored in a cookie, `localStorage`, or `sessionStorage`. A JWS signature provides integrity/authenticity, not confidentiality; claims are readable. Do not include secrets in payload. Validate signature, allowed algorithm, expiration, issuer/audience, subject, and required claims. No CSRF token is used in this project.

## 5. Endpoints

### 5.1 Sign up

`POST /api/v1/auth/signup`

No JWT required. Creates an in-memory demo account that is lost on backend restart. Password uses Spring Security `BCryptPasswordEncoder`.

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
    "accessToken": "<signed-application-jwt>",
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

Client holds `accessToken` in memory. Errors: 400 validation, 401 generic `INVALID_CREDENTIALS`. Never return password or hash. No cookie is set.

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
    "accessToken": "<signed-application-jwt>",
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

Errors: 400 `BAD_REQUEST` for invalid/expired/replayed code; 401 `UNAUTHENTICATED` for invalid exchange credential, using a generic policy that does not disclose code validity.

### 5.5 Homepage

`GET /api/v1/homepage`

Authentication: bearer JWT.

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

### 5.6 List mock products

`GET /api/v1/products`

Authentication: bearer JWT.

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

### 5.7 Add mock product

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

### 5.8 Hide mock product

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

### 5.9 Inspect authentication context

`GET /api/v1/auth/sessions`

Authentication: bearer JWT. Read-only; no mutation.

Success: envelope with safe user summary, `authMode: "JWT"`, and expiry. Never include JWT, password/hash, provider access token, signing material, or session ID.

### 5.10 Logout

`DELETE /api/v1/auth/sessions`

Authentication: bearer JWT.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed out.",
  "data": null
}
```

Frontend clears its in-memory JWT. Unless server-side revocation is implemented, a stateless JWT may remain valid until expiry; do not imply that this endpoint revokes it. Product localStorage is not cleared by logout.

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
