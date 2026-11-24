# API Contract — CSRF_JWT_OAuth Shop

## 1. Purpose and scope

This document defines the version 1 HTTP API for the mock shop and its authentication learning flows. It follows the current `PRD.md`, `README.md`, and `use_case.md`.

The backend has no database. Demo accounts are held in memory and reset when the backend restarts. The product catalog is fixed mock data. Product add/hide endpoints validate the request and return an acknowledgement; they do not persist product changes. The frontend persists accepted additions and hidden IDs in `localStorage`.

## 2. Conventions

- Base path: `/api/v1`
- Request and response content type: `application/json; charset=utf-8`, except OAuth browser redirects/callbacks.
- JSON property names: `camelCase`.
- Dates/times: ISO 8601 UTC strings when present.
- IDs: opaque strings; clients must not infer meaning from them.
- No pagination is defined for the fixed mock catalog. Do not return empty pagination metadata.
- All API JSON responses use the envelope in section 3.
- OAuth authorization and callback routes are Spring Security browser routes, not JSON API endpoints, and are listed separately.

## 3. Standard response envelope

Every JSON API success or error response uses this shape:

```json
{
  "code": "OK",
  "message": "Request completed.",
  "data": {}
}
```

### Fields

| Field | Required | Meaning |
|---|---:|---|
| `code` | Yes | Stable application code. Clients should branch on this field or the HTTP status, not parse `message`. |
| `message` | Yes | Short, safe, human-readable summary. |
| `data` | Yes | Operation result. Use an object, array, or `null` where appropriate. |

Keep the envelope compact. Do not include `success`, duplicate HTTP status fields, empty `meta`, pagination fields, or echoed request headers. HTTP status is authoritative for transport-level success/failure. An optional `requestId` may be added later if observability requires it; it is omitted by default to avoid response overhead.

### Success example

```json
{
  "code": "OK",
  "message": "Products loaded.",
  "data": {
    "products": []
  }
}
```

### Validation error example

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

For an error with no additional details, set `data` to `null`. Error messages must not disclose whether an account exists or expose secrets, tokens, stack traces, or provider responses.

## 4. HTTP status and application codes

| HTTP status | Example application code | Use |
|---:|---|---|
| `200 OK` | `OK` | Successful read or operation with a response body. |
| `201 Created` | `CREATED` | Successful local sign-up or accepted product creation. It means the demo operation succeeded; product creation is still only persisted by the frontend. |
| `204 No Content` | Not used for JSON API responses | Avoid because every API response uses the envelope. Use `200` with `data: null` for successful logout/hide acknowledgement. |
| `400 Bad Request` | `VALIDATION_ERROR`, `BAD_REQUEST` | Invalid body, malformed ID, or invalid fields. |
| `401 Unauthorized` | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN` | Missing/invalid authentication or sign-in failure. Sign-in errors use a generic message. |
| `403 Forbidden` | `FORBIDDEN` | Authenticated user lacks permission. |
| `404 Not Found` | `NOT_FOUND` | Unknown endpoint/resource where applicable. Product IDs are demo/client-owned; backend may return accepted acknowledgement without checking catalog membership, as it does not own persistent product state. |
| `409 Conflict` | `EMAIL_ALREADY_REGISTERED` | Duplicate email during in-memory sign-up. |
| `415 Unsupported Media Type` | `UNSUPPORTED_MEDIA_TYPE` | Unsupported request content type. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | Unexpected server error with a generic message. |

The HTTP status and envelope `code` must agree. Do not return HTTP `200` for authentication or validation failures.

## 5. Authentication and CSRF headers

### JWT authentication

The backend issues the application JWT after sign-in. The client keeps it in memory and explicitly sends it on protected requests:

```http
Authorization: Bearer <jwt>
```

This project does not use session cookies. Do not store the JWT in a cookie, `localStorage`, or `sessionStorage`. `HttpOnly` is a cookie attribute and does not apply to this bearer-header design.

### CSRF token policy

The project intentionally requires both credentials on authenticated state-changing API requests (`POST`, `PUT`, `PATCH`, and `DELETE`):

```http
Authorization: Bearer <jwt>
X-CSRF-TOKEN: <csrf-token>
```

The backend must validate the JWT and validate that the CSRF token belongs to the authenticated login context (for example, bind it to JWT `jti` and expiry, or keep a short-lived in-memory association). Do not accept any arbitrary non-empty header as a valid CSRF token.

Because the JWT is explicitly attached by JavaScript and is not an automatically sent cookie, this additional CSRF header is not needed to mitigate classic cookie-based CSRF. It is a deliberate extra request-validation rule for this learning project. Explain that distinction in the UI and docs.

Sign-up/sign-in happen before an authenticated JWT exists, so they cannot require one. They require the pre-authentication CSRF token where specified below. OAuth callback routes validate OAuth `state` and follow the provider flow.

The CSRF token is returned in JSON and kept in client memory; JSON values cannot have the `HttpOnly` attribute. OAuth `state`, the CSRF token, application JWT, and provider access token are distinct values.

### Ephemeral security-state storage guidance

- For the initial single-instance local project, an in-memory store with explicit TTL and cleanup is sufficient for pre-auth/authenticated CSRF associations and one-time OAuth handoff codes.
- If the app later runs on multiple instances or must survive process restarts, Redis is a suitable ephemeral store for these short-lived records. Store hashes of opaque CSRF/handoff values where practical, set TTLs, namespace keys, protect Redis with network isolation/authentication/TLS as appropriate, and atomically consume one-time handoff codes (for example, `GETDEL` or a transaction/script).
- Align authenticated CSRF-record TTL with the associated JWT expiry and invalidate/expire both consistently.
- Do not store the JWT signing secret/private key in Redis. Use environment configuration for local development and a dedicated secret manager or KMS for deployed environments; rotate keys through an explicit key-version policy.
- Redis is not the user's product database in this project; product records remain browser-local mock state.

## 6. Endpoint contracts

### 6.1 Obtain a CSRF token

`POST /api/v1/csrf-token`

Returns an educational CSRF token for display/header demonstration. No session is initialized and no cookie is set. The endpoint should return a stable token for the current demo flow rather than rotating it on every retry.

Request body: none. The endpoint issues a short-lived pre-authentication token for sign-up/sign-in.

Response: `200 OK`

```json
{
  "code": "OK",
  "message": "CSRF token issued.",
  "data": {
    "token": "<csrf-token>",
    "headerName": "X-CSRF-TOKEN",
    "expiresAt": "2026-11-24T12:00:00Z"
  }
}
```

The UI may show the token in local development for learning purposes. Never log it. This token is separate from OAuth `state`, JWT, and provider access tokens.

### 6.2 Sign up

`POST /api/v1/auth/signup`

Creates an in-memory demo account. Accounts are lost when the backend restarts. Passwords must be hashed with Spring Security `BCryptPasswordEncoder`, even for this learning project. BCrypt is one-way hashing; the server verifies a candidate password with the encoder and never decrypts the stored hash.

Request headers: `X-CSRF-TOKEN: <pre-auth-token>` (no JWT exists yet).

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

Errors: `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_REGISTERED`.

### 6.3 Sign in

`POST /api/v1/auth/signin`

Request header: `X-CSRF-TOKEN: <pre-auth-token>` (no JWT exists before sign-in).

Request:

```json
{
  "email": "learner@example.test",
  "password": "example-password"
}
```

Authentication is JWT-only; no `mode` field is accepted.

Success in JWT mode: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed in.",
  "data": {
    "accessToken": "<application-jwt>",
    "tokenType": "Bearer",
    "csrfToken": "<csrf-token-bound-to-this-login>",
    "csrfHeaderName": "X-CSRF-TOKEN",
    "expiresAt": "2026-11-24T12:00:00Z",
    "user": {
      "id": "usr_demo_01",
      "email": "learner@example.test",
      "loginMethod": "PASSWORD",
      "provider": null
    }
  }
}
```

The client keeps `accessToken` in memory only. The JSON envelope returns the user summary. No session cookie is set.

Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` with a generic message. Never return the password or password hash. Store only the BCrypt hash in the in-memory account record; never retain the raw password after request processing.

### 6.4 OAuth login and one-time token handoff

OAuth browser routes do not use the JSON envelope:

- Google start: `GET /oauth2/authorization/google`
- Google callback: `GET /login/oauth2/code/google`
- Facebook start: `GET /oauth2/authorization/facebook`
- Facebook callback: `GET /login/oauth2/code/facebook`

The provider's authorization code is returned to the backend callback and exchanged server-to-server. It is never sent to the frontend. After validating OAuth `state`, provider identity, and account policy, the backend creates a random, short-lived, single-use **application handoff code** associated with the authenticated principal/provider. The callback redirects to a fixed allowlisted frontend callback URL carrying only this handoff code, never the JWT or CSRF token.

For popup UX, the frontend callback page sends the handoff code to its opener using `postMessage` with an exact configured origin, then closes. The opener submits the code to the exchange endpoint. For same-tab UX, the callback page submits the code directly. The callback page must use `Cache-Control: no-store`, a restrictive `Referrer-Policy`, no third-party resources, and remove the code from browser history as soon as practical.

Spring Security validates OAuth `state`. Its default authorization-request repository stores the authorization request in `HttpSession`; confirm whether a transient OAuth-only session cookie is permitted. If the requirement is no cookies at all, configure a secure alternative that preserves one-time state and browser binding. Do not disable state validation to avoid a cookie.

#### 6.4.1 Exchange OAuth handoff code

`POST /api/v1/auth/oauth/exchange`

Authentication: no JWT yet. Requires the pre-auth CSRF header and a valid handoff code.

Request header:

```http
X-CSRF-TOKEN: <pre-auth-csrf-token>
```

Request body:

```json
{
  "code": "<short-lived-one-time-app-handoff-code>"
}
```

The code must be high entropy, short-lived, bound to the completed OAuth transaction/provider identity, and atomically consumed once. Expired, replayed, malformed, or mismatched codes must fail without issuing credentials.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "OAuth sign-in completed.",
  "data": {
    "accessToken": "<application-jwt>",
    "tokenType": "Bearer",
    "csrfToken": "<csrf-token-bound-to-this-login>",
    "csrfHeaderName": "X-CSRF-TOKEN",
    "expiresAt": "2026-11-24T12:00:00Z",
    "user": {
      "id": "usr_demo_oauth_01",
      "email": "learner@example.test",
      "loginMethod": "GOOGLE",
      "provider": "google"
    }
  }
}
```

The frontend keeps JWT and CSRF in memory. Errors use the standard envelope: `400 BAD_REQUEST` for malformed/expired/replayed handoff code, `403 CSRF_INVALID` for missing/invalid pre-auth CSRF, and `401 UNAUTHENTICATED` where the exchange credential is invalid. Do not reveal whether a particular code was valid beyond the agreed generic error policy.

### 6.5 Homepage

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

Errors: `401 UNAUTHENTICATED`, `403 FORBIDDEN`.

### 6.6 List mock products

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

The catalog is fixed and small; there are no `page`, `size`, `totalElements`, or `links` fields. The client merges this list with local additions and filters locally hidden IDs.

### 6.7 Add a mock product

`POST /api/v1/products`

Authentication: bearer JWT plus `X-CSRF-TOKEN`.

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

The client creates an opaque ID. The backend validates the fields and authentication, then acknowledges the operation without saving the product.

Success: `201 Created`

```json
{
  "code": "CREATED",
  "message": "Product accepted for the local demo.",
  "data": {
    "product": {
      "id": "prd_local_a1b2",
      "name": "Ceramic Mug",
      "description": "A mock product added in the shop UI.",
      "price": 9.5,
      "currency": "USD",
      "imageUrl": null
    }
  }
}
```

Only after success does the frontend save the returned product in `localStorage`. Errors: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN` or `CSRF_INVALID`.

### 6.8 Hide a mock product

`DELETE /api/v1/products/{productId}`

Authentication: bearer JWT plus `X-CSRF-TOKEN`.

No request body.

The backend validates the request and acknowledges the demo operation; it does not delete a server-side record.

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

Only after success does the frontend add `productId` to its local hidden-ID list and filter the product out. Errors: `400 BAD_REQUEST` for malformed IDs, `401 UNAUTHENTICATED`, `403 FORBIDDEN` or `CSRF_INVALID`.

### 6.9 Inspect authenticated context

`GET /api/v1/auth/sessions`

Authentication: bearer JWT only. This is a read-only endpoint; CSRF header is not required.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Authentication context loaded.",
  "data": {
    "user": {
      "id": "usr_demo_01",
      "email": "learner@example.test",
      "loginMethod": "PASSWORD",
      "provider": null
    },
    "authMode": "JWT",
    "expiresAt": "2026-11-24T12:00:00Z"
  }
}
```

Do not include the JWT, CSRF token, password, or provider access token in this response.

### 6.10 Logout

`DELETE /api/v1/auth/sessions`

Authentication: bearer JWT plus `X-CSRF-TOKEN`.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed out.",
  "data": null
}
```

Clear the client-held JWT. Unless a revocation list is implemented, an issued stateless JWT may remain valid until expiration; the response must not imply server-side revocation when none exists. Product `localStorage` is not cleared by logout.

## 7. Common error responses

### CSRF rejected

HTTP `403 Forbidden`

```json
{
  "code": "CSRF_INVALID",
  "message": "The CSRF token is missing, invalid, or not associated with this login.",
  "data": null
}
```

### Unauthenticated

HTTP `401 Unauthorized`

```json
{
  "code": "UNAUTHENTICATED",
  "message": "Authentication is required.",
  "data": null
}
```

### Invalid fields

HTTP `400 Bad Request`

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request contains invalid fields.",
  "data": {
    "fieldErrors": {
      "price": "Must be zero or greater."
    }
  }
}
```

## 8. Product and auth data rules

### Product

- `id`: required opaque client-generated string for local additions; fixed IDs for seed products.
- `name`: required, 1–100 characters.
- `description`: optional, maximum 500 characters.
- `price`: required finite number, greater than or equal to zero; no currency conversion.
- `currency`: required 3-letter uppercase code; initial demo uses `USD` consistently.
- `imageUrl`: optional absolute URL or `null`; UI may use a local placeholder.

### User summary

Only expose `id`, `email`, `loginMethod`, and `provider` when available. Never expose password hashes, raw OAuth claims beyond the allowed profile fields, provider access tokens, or signing material. Use `BCryptPasswordEncoder.matches(rawPassword, storedHash)` for verification; never compare raw passwords to stored hashes.

## 9. Request Inspector behavior

The UI may show method, path, relevant headers, status, and response envelope for learning. Mask credentials by default; provide a clearly labeled local-only reveal if token visualization is part of the UI requirement. Never log tokens to the backend. Product body/response should show the mock fields only.
