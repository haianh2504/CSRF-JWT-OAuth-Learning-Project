# API Contract — JWT OAuth Mock Shop

## 1. Purpose and conventions

This contract defines the Spring Boot API for the mock shop. The initial backend has no relational database: a process-local in-memory user store holds demo accounts, Redis holds refresh-token hashes/session state, account-lock state, per-account session indexes, and session denylist entries keyed by `sid`; the fixed product catalog is mock data. Product add/hide requests are acknowledged but not persisted by the backend; frontend persists local additions and hidden IDs.

The user store is a singleton backend service backed by an in-memory map (for example, `ConcurrentHashMap`), keyed by normalized email; OAuth identities are associated by provider and stable provider subject. It stores only account ID, normalized email, BCrypt password hash for password accounts, and OAuth identity mapping. It is available across requests in the single backend process and is cleared on restart. This learning setup runs one backend instance with one local Redis instance; Redis is not shared across backend instances. `localStorage` is reserved for frontend product state and is not used for accounts or authentication.

- Base path: `/api/v1`
- JSON content type: `application/json; charset=utf-8`; OAuth routes are redirects/callbacks and not JSON APIs.
- JSON keys use `camelCase`; dates use ISO 8601 UTC.
- Every JSON API response uses the envelope in section 2.
- JWT authentication uses signed compact JWS, with three Base64URL-encoded parts: `header.payload.signature`. Payload is not encrypted.
- Access JWTs have a 10-minute lifetime and are kept in JavaScript memory only. Protected business endpoints require `Authorization: Bearer <access-JWT>`, except signup/signin, OAuth handoff exchange, and refresh.
- Sign-in and OAuth exchange return an access JWT and set an opaque refresh-token cookie with `HttpOnly; SameSite=Lax`, at most 7 days idle and never past the session's 15-day absolute expiry. Set `Secure=false` only for local HTTP and `Secure=true` for HTTPS. Refresh/logout use that cookie and require a session-bound CSRF token generated with `SecureRandom`; the frontend copies the JavaScript-readable `XSRF-TOKEN` cookie into `X-CSRF-TOKEN`. Redis stores the CSRF token hash for that session, so no CSRF-token signature is needed. This CSRF validation applies only to refresh and logout, not Bearer-authenticated business endpoints.
- Refresh tokens are high-entropy random opaque strings encoded as unpadded Base64URL. For refresh-token state, Redis stores only SHA-256 hashes and session/token-family metadata, never raw refresh tokens. A session family has a 15-day absolute lifetime from login; each refresh token has at most a 7-day idle lifetime, capped by the family expiry. Consumed-token hashes remain until that token's original expiry (at most 7 days), bounded by family expiry, so replay while the old token could still be valid is detected. Separately, Redis stores a session denylist keyed by `sid` with TTL through the latest access-token `exp` in the session. SHA-256 is hashing, not encryption.
- Refresh rotation is atomic: a valid current token is consumed once and replaced; reuse before the consumed token's original expiry revokes the associated token family/session. Every refresh-token hash maps to a `sid`; refresh preserves that `sid`, creates a new access-token `jti`, and updates the session's latest access-token `exp` in Redis. No refresh or access-token expiry may extend beyond the session's 15-day absolute expiry; cap access JWT `exp` at that instant.
- Each successful login creates a UUID v4 `sid`; all access JWTs and the opaque refresh-token family in that session share it. `jti` remains a unique UUID v4 per access JWT.
- Local Redis stores a session denylist keyed by `sid`. After validating signature/algorithm, required claims, and time validity (`iat`, `exp`, `exp - iat`), every protected API checks the `sid` denylist before authorization. A match returns 401. Denylist TTL is the remaining time until the latest access-token `exp` recorded for that session (`max(0, latestAccessExp - currentTime)`); do not retain an entry beyond that expiry. Fail closed if Redis cannot be checked. Never store complete JWTs or signing keys.
- Access JWTs use symmetric HS256 (HMAC-SHA-256); the protected header declares `alg: HS256`, and verifiers allow only that algorithm. The JWS signing input is `<base64url(header)>.<base64url(payload)>`; the signature segment is `Base64URL(HMAC-SHA256(secretKey, signingInput))`.
- Provision a 32-byte (256-bit) secret key from a cryptographically secure random generator such as Java `SecureRandom`. Load the same configured key for issuance and verification. Do not generate a key per login or restart, rotate it, hardcode it in source, expose it to the frontend, include it in JWTs, or store it in Redis. This project rotates refresh tokens only; signing-key rotation is out of scope. Use local environment configuration and a secret manager/KMS in deployed environments.
- Every access JWT contains `iss` (`http://localhost:8080`, the local Spring backend issuer), `sub` (stable account ID), `aud` (`http://localhost:3000`, the local frontend app audience for this learning project), `exp`, `iat`, `jti` (fresh random UUID v4 per access JWT), `sid` (UUID v4 created once at successful login and kept unchanged for the session's access/refresh lifecycle), and `token-type: access`. Never reuse `jti` or `sid`. Validate the configured exact issuer and audience. The frontend audience is an intentional learning choice; in a conventional access-token design, `aud` identifies the protected API/resource server that validates the bearer token. Do not include a `role` claim and reject any access JWT containing `role`, even if its signature is otherwise valid. Refresh tokens remain opaque and carry no JWT claims; Redis maps their hashes to `sid`.
- Signing-key rotation is out of scope. The configured 32-byte HS256 key remains fixed across logins and restarts; only refresh tokens rotate.
- This project runs one backend instance with one local Redis instance; Redis is not shared across backend instances. Store OAuth state, OAuth handoff-code hashes, refresh-token hashes, and session/revocation state in this Redis with TTLs and atomic one-time consumption/rotation. Fail closed when Redis is unavailable.
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
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` | Malformed request or invalid input. |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN` | Missing/invalid authentication credentials; not used for CSRF failure. |
| 403 | `FORBIDDEN`, `CSRF_INVALID` | Authenticated request is disallowed or CSRF proof is missing/invalid. |
| 503 | `SERVICE_UNAVAILABLE` | Redis required for session, refresh, denylist, or revocation state is unavailable; fail closed and do not claim the requested operation succeeded.
| 404 | `NOT_FOUND` | Unknown route/resource. |
| 409 | `EMAIL_ALREADY_REGISTERED` | Duplicate in-memory account. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported content type. |
| 500 | `INTERNAL_ERROR` | Generic unexpected application error; use for an unexpected failure, not known Redis unavailability. |
| 502 | `OAUTH_PROVIDER_ERROR` | Provider token/profile response failed or was invalid; OAuth callback returns a safe non-JSON error page. |
| 504 | `OAUTH_PROVIDER_TIMEOUT` | Provider token/profile request timed out; no account/session/credentials are issued. |

HTTP status and envelope code must agree. Do not return 200 for errors. JSON APIs return an envelope rather than 204.

## 4. JWT bearer contract

After authentication, the backend issues a signed JWT. The frontend keeps it in memory and sends:

```http
Authorization: Bearer <jwt>
```

The access JWT lifetime is at most 10 minutes and is capped at the session absolute expiry; it is kept in JavaScript memory and sent in the Authorization header, not stored in cookies, `localStorage`, or `sessionStorage`. A JWS signature provides integrity/authenticity, not confidentiality; claims are readable. Do not include secrets in payload. Sign with HS256 using a provisioned 32-byte secret key held only in backend configuration/secret management, stable across logins and restarts. Validate the HMAC signature and only accept `alg: HS256`. Require `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `sid`, and `token-type: access`; do not issue a `role` claim and reject any otherwise valid signed access JWT that contains `role`. In this project, `iss` is `http://localhost:8080` and `aud` is `http://localhost:3000`. RFC 7519 defines `aud` as the intended JWT recipient; naming the frontend is this project's requested learning choice, while conventional API access tokens normally name the resource server that validates the bearer token. In JSON responses, `tokenType: Bearer` names the Authorization scheme; JWT claim `token-type: access` identifies token purpose. The opaque refresh token has up to 7 days idle lifetime and is set as an HttpOnly SameSite=Lax cookie (`Secure` off only for local HTTP, on for HTTPS); it is never returned in JSON. Only refresh and logout require CSRF validation: backend generates a unique, unpredictable CSRF value with `SecureRandom` for each login session, stores only its SHA-256 hash in Redis keyed by `sid`, sets the value in a JavaScript-readable `XSRF-TOKEN` cookie, and the frontend copies it into `X-CSRF-TOKEN`. The backend requires cookie/header equality and a constant-time match against the stored session hash; the CSRF token itself is not signed. Other business endpoints do not require CSRF tokens. On successful logout, the backend deletes the session CSRF record, clears both CSRF and refresh cookies, and denies the session `sid` in Redis through that session's latest access-token `exp`; protected requests check `sid` after cryptographic signature, claim, and expiry validation. If Redis is unavailable, protected requests fail closed with a service error rather than accepting a token whose revocation status cannot be checked.

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

Client holds `accessToken` in memory. A successful sign-in creates a new `sid` and initial `jti`, sets `sessionExpiresAt` to 15 days from login, stores the session record, initial latest-access `exp`, and SHA-256 hash of a per-session `SecureRandom` CSRF token in local Redis, and maps the refresh-token hash to that `sid`; the response sets the opaque refresh token as an `HttpOnly; SameSite=Lax` cookie with expiry `min(now + 7 days, sessionExpiresAt)` and issues the CSRF value in the JavaScript-readable `XSRF-TOKEN` cookie. Set `Secure` false only for local HTTP development and true for HTTPS deployments. Do not include the refresh token in JSON. Errors: 400 validation, 401 generic `INVALID_CREDENTIALS`. Never return password or hash.

### 5.3 OAuth start and callback

OAuth browser routes are not JSON envelope endpoints:

- Google: `GET /oauth2/authorization/google`; callback `GET /login/oauth2/code/google`
- Facebook: `GET /oauth2/authorization/facebook`; callback `GET /login/oauth2/code/facebook`

For this local single-backend design, store OAuth state and handoff-code records in local Redis; Redis is not shared across backend instances. Generate each state, browser-binding value, and handoff code as 32 random bytes using `SecureRandom`, and encode as unpadded Base64URL. Store only SHA-256 hashes of state, browser-binding value, and handoff code; do not embed account or browser information in the state string. State has a 5-minute TTL. Its Redis record includes provider, exact allowlisted redirect/callback, expiry, browser-binding hash, and PKCE verifier. Send the corresponding PKCE S256 challenge to the provider. Set the browser-binding value in a separate short-lived `HttpOnly; SameSite=Lax` cookie (`Secure` in HTTPS deployments, off only for local HTTP); this custom cookie value is distinct from any OpenID Connect `nonce`. On callback, atomically validate the state record and browser-binding hash, consume/delete the record only on a valid match, retain the PKCE verifier in callback memory, and then exchange the provider authorization code server-to-server. Invalid callbacks return 400 without creating accounts or sessions. Provider authorization code is never sent to frontend. The handoff record maps the one-time code to the verified local account/provider identity, not to an access token; it expires in 60 seconds and is atomically consumed and deleted on successful exchange. Redis TTL removes expired records. The frontend allows only one pending OAuth popup at a time so the browser-binding cookie cannot be overwritten by a parallel start.

This project uses the popup flow. The frontend opens the backend authorization route from a user gesture. After successful provider validation, backend redirects the popup to the exact allowlisted frontend callback with only `?handoff=<app-handoff-code>`; the provider's `?code=` is used only by the backend callback. The popup callback copies the handoff value to memory, removes it from its URL/history, then posts `{ type: "OAUTH_HANDOFF", code: "..." }` to the opener using an exact target origin. The opener validates `event.origin`, `event.source`, and payload shape, exchanges the handoff code, and acknowledges receipt before the popup closes. Never send the app JWT through the redirect or `postMessage`. Use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and no third-party resources on the callback. Popup blockers, closed windows, and provider errors must have a recoverable UI state.

OAuth browser callback status behavior (these are not JSON-envelope routes): successful start and successful completion use 302 redirects; a valid provider-denial response consumes the matching state and redirects 302 to the fixed frontend callback with a safe `oauthError` code and no handoff code. A verified-email collision or missing/unverified email also redirects 302 with a safe frontend error code and no account/session. Missing/malformed/mismatched/expired/replayed/cross-browser state, or a missing authorization code without an explicit provider error, returns HTTP 400 with a generic no-store error page and no credentials. Redis failure during state lookup/consumption returns HTTP 503 with a generic no-store page. Provider token/profile rejection returns 502; provider timeout returns 504. Never redirect to a callback or return URL supplied by an untrusted request parameter. The local frontend callback is `http://localhost:3000/`; production must configure the exact deployed callback URL.
The browser-facing provider redirect URIs are `http://localhost:3000/login/oauth2/code/google` and `http://localhost:3000/login/oauth2/code/facebook`, routed by the Next.js rewrite to the Spring callback handlers on port 8080. Register these exact public URLs with each provider. This lets the browser-binding cookie created on the frontend host return on the callback through the same proxy. After successful authentication, the separate app handoff callback is the frontend root `http://localhost:3000/`.

Do not use Spring Security's default `HttpSession` repository for this design; use the documented local Redis state record and preserve the browser-binding check. Do not disable OAuth state validation.

### 5.4 Exchange OAuth handoff code

`POST /api/v1/auth/oauth/exchange`

No app JWT yet. Request:

```json
{
  "code": "<short-lived-one-time-app-handoff-code>"
}
```

Generate the handoff code from 32 `SecureRandom` bytes and encode as unpadded Base64URL. Redis stores only its SHA-256 hash mapped to the verified local account/provider identity and completed transaction, with a 60-second TTL. Atomically consume and delete the record on successful exchange. Expired, replayed, mismatched, or malformed codes fail without issuing a JWT.

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

OAuth exchange creates a new login session with a new `sid`, an absolute expiry 15 days from login, and an initial `jti`; it stores session metadata and latest-access `exp` in Redis, and maps the refresh-token hash to that `sid`. The response also sets the opaque refresh token as an `HttpOnly; SameSite=Lax` cookie, with idle expiry no later than 7 days and absolute expiry no later than the session end, and issues the bound `XSRF-TOKEN` cookie; never return the refresh token in JSON. Errors: 400 `VALIDATION_ERROR` if the JSON body is malformed or `code` is missing, non-string, or empty; 401 `UNAUTHENTICATED` for any non-empty code that is unknown, malformed, expired, replayed, or mismatched, with the same generic response so code validity is not disclosed; 503 `SERVICE_UNAVAILABLE` if Redis is unavailable.

### 5.5 Refresh access token

`POST /api/v1/auth/refresh`

No access JWT required. Browser sends the refresh-token cookie, the `XSRF-TOKEN` cookie, and `X-CSRF-TOKEN` header. The backend requires cookie/header equality and verifies the token's SHA-256 hash matches the CSRF hash stored for the refresh session's `sid`; the CSRF value is random and is not signed. This is required only for refresh and logout. Refresh token is opaque high-entropy random data encoded as unpadded Base64URL, is not a JWT, has a 7-day idle lifetime, and cannot outlive its 15-day session family.

The backend computes SHA-256 over the exact presented Base64URL token string and looks up the hash in Redis, including its associated `sid` and session state. Refresh tokens are opaque, so they are validated by this Redis session/token-family state rather than JWT signature or JWT claims. In one atomic operation, it verifies the token is current/unconsumed and the account/session is not locked, revoked, deny-listed, or past its 15-day absolute expiry; consumes the old token; stores a consumed-token hash marker until the old token's original expiry; stores the replacement hash mapped to the same `sid`; issues a new access JWT with a fresh `jti` and unchanged `sid`; caps `exp` at session expiry; and updates the session's latest access-token `exp`. The new refresh cookie gets `min(now + 7 days, session absolute expiry)`. Never return the refresh token in JSON or write it to logs.

If a consumed token is presented again before its original expiry, revoke the whole token family/session and require sign-in. A replay after the original expiry is rejected as expired and cannot refresh; it does not need to revoke a still-valid family. Unknown, expired, revoked, or reused refresh tokens return 401 without issuing tokens; invalid CSRF proof returns 403. If Redis is unavailable, fail closed with 503 `SERVICE_UNAVAILABLE` and issue no tokens. Active refresh-token Redis entries and cookies have a TTL of `min(7 days, remaining session lifetime)`; consumed-token markers expire at the original token expiry, no later than the 15-day family expiry. Add `Cache-Control: no-store` headers.

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

Authentication: require `Authorization: Bearer <access-JWT>`, the current refresh-token cookie, and CSRF/origin validation. Validate the signed, unexpired access JWT; require its `sid` and `sub` to match the refresh session; and verify the CSRF proof is bound to that session. If the access JWT has expired, the client silently refreshes first, preserving the `sid`, then submits logout. The refresh happens without exposing a separate step in the UI.

Success: `200 OK`

```json
{
  "code": "OK",
  "message": "Signed out.",
  "data": null
}
```

Backend atomically revokes the entire refresh-token family/session and adds `deny:session:<sid>` to the local Redis denylist. All access JWTs in the session share `sid`, so protected requests reject every one of them after signature, claims, and time-validity checks. Refresh attempts are also rejected when their mapped `sid` is deny-listed or their family is revoked. Set the denylist TTL to the session's latest access-token expiry minus current time, using Redis session metadata updated on every issuance/refresh; validate every access JWT's `iat`, `exp`, and maximum lifetime before checking its `sid`. Do not keep the denylist entry beyond the latest `exp`. Expire both refresh and CSRF cookies. If Redis is unavailable, fail closed and return a service error without claiming logout completed. Frontend sends the access token and CSRF proof, then clears its in-memory access JWT after success. Product localStorage is not cleared by logout.

### 5.12 Admin-triggered account lock

When a trusted admin action locks an account, store its locked status as a non-expiring Redis key until explicitly unlocked; reject new sign-in and refresh attempts. Durability across Redis restarts depends on Redis persistence configuration, which remains deployment-specific. Find every active `sid` for that account, revoke each refresh-token family, and add `deny:session:<sid>` with TTL through that session's latest access-token `exp`. This rejects all existing access JWTs in every active session. Session creation/refresh must serialize with the account-lock check so no new token is issued after the lock takes effect. The admin-management endpoint and how admin authority is established are not defined in the current API contract and remain open.

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

OAuth identity is keyed by `(provider, stable provider subject)`. If that identity is already linked, use its existing account. Do not auto-link a new provider identity to an existing account based only on matching email. For this learning version, reject missing/unverified provider email (`oauthError=profile_not_eligible`) and verified-email collisions with existing accounts (`oauthError=account_link_required`); create an account only when the provider email is verified and not already assigned. A provider denial uses `oauthError=access_denied`. These safe codes are returned only on the fixed frontend callback; they carry no provider details or credentials. Adding an explicit authenticated account-linking flow is out of scope.

## 8. Browser, cookie, and deployment contract

The current frontend uses Next.js rewrites for `/api/*` and OAuth routes, so browser requests remain same-origin at `http://localhost:3000`; this path does not require CORS. The proxy must forward incoming `Cookie` headers to the backend and preserve every `Set-Cookie` response header to the browser. Local cookies are host-only (omit `Domain`); use refresh cookie `Path=/api/v1/auth`, readable `XSRF-TOKEN` cookie `Path=/` so frontend code at `/` can read it, and OAuth browser-binding cookie `Path=/login/oauth2/code` so only provider callbacks receive it. `SameSite=Lax` is used; set `Secure=false` only in local HTTP development and `Secure=true` for HTTPS deployment. Clear the binding cookie with the same path and domain attributes. For initial MVP, frontend allows only one pending OAuth popup at a time to avoid overlapping browser-binding cookies.

If the browser is configured to call `http://localhost:8080` directly, it is a different origin from port 3000: enable credentialed fetches and allow exactly `http://localhost:3000` in CORS, including required headers/methods. Do not use wildcard `Access-Control-Allow-Origin` with credentials. In production, prefer the current same-origin proxy pattern on the deployed frontend and verify cookie forwarding end to end. If switching to direct frontend-to-API calls, configure exact origins and keep frontend/API same-site for `SameSite=Lax`; choose production `Domain`/`Path` deliberately. A default Vercel domain and API on a different site may require a custom shared domain or same-origin proxy.
