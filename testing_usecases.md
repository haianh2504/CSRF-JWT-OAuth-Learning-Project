# Testing Use Cases — JWT OAuth Mock Shop

## 1. Purpose and baseline assumptions

This plan derives from `PRD.md`, `README.md`, `use_case.md`, and `api_contract.md`. It is a test specification, not evidence that code has been implemented or run.

- Protected business APIs use a signed compact JWS access JWT with exactly three Base64URL-encoded segments, a 10-minute lifetime, and JavaScript-memory-only client storage; it is not encrypted. Refresh tokens are opaque, not JWTs.
- Access JWTs use only HS256 (HMAC-SHA-256) and a 32-byte secret provisioned once with a cryptographically secure random generator; the same configured key is used across logins and restarts, with no signing-key rotation in this project. Only refresh tokens rotate. The key is never hardcoded, sent to the frontend, placed in a JWT, or stored in Redis.
- Each access JWT requires `iss`, `sub`, `aud`, `exp`, `iat`, `jti` (fresh UUID v4 per access token), `sid` (UUID v4 created once per successful login and unchanged across refresh), and `token-type: access`; never reuse `jti` or `sid`. The issuer must never emit a `role` claim, and the validator rejects any access JWT containing `role`, even when signed with the correct test/server key.
- Protected business endpoints require `Authorization: Bearer <access-JWT>`.
- Refresh uses a high-entropy opaque unpadded-Base64URL token with a 7-day lifetime in an `HttpOnly; Secure; SameSite=Lax` cookie. Redis maps SHA-256 refresh-token hashes to `sid`, stores session/family state and latest access-token `exp`, account-lock state and active-session indexes, plus a session denylist keyed by `sid` through the latest `exp`; SHA-256 is one-way hashing, not encryption. Never store complete JWTs or signing keys in Redis.
- Refresh rotation is atomic and single-use; reuse of an already consumed token revokes its family/session. Refresh and logout require a session-bound CSRF token generated with `SecureRandom`; Redis stores its SHA-256 hash by `sid`, the frontend copies `XSRF-TOKEN` into `X-CSRF-TOKEN`, and the backend checks cookie/header equality and the session hash. The CSRF token is not signed. Logout additionally requires an access JWT. Business APIs require Bearer JWT; after signature, claims, and expiry validation, they check its `sid` against the local Redis denylist. They do not require CSRF tokens.
- Sign-up, sign-in, OAuth exchange, and refresh do not require a current access JWT.
- Sign-up, sign-in, and OAuth handoff exchange are pre-authentication endpoints and cannot require the app JWT they create.
- OAuth provider authorization code is exchanged backend-to-provider. Frontend receives only a short-lived, one-time app handoff code, then exchanges it for the app JWT.
- No relational database and one backend instance only: a singleton backend in-memory user store holds accounts across requests within the Spring Boot process, then resets on restart. Redis is local to this backend and is not shared across backend instances. It holds refresh-token hashes mapped to `sid`, session state, account lock state, active-session indexes, `sid` denylist entries through each session's latest access-token expiry, CSRF token hashes, OAuth state hashes, and OAuth handoff-code hashes; it does not hold complete JWTs or signing keys. Catalog is fixed mock data; product mutations are acknowledged but not persisted on backend.
- Frontend stores accepted product additions and hidden IDs in `localStorage`; account data is backend-only, access JWT stays in memory, and 7-day refresh token is held only in the HttpOnly cookie; the `XSRF-TOKEN` cookie is intentionally readable by frontend JavaScript.
- JSON APIs use `{ "code", "message", "data" }`; OAuth redirects/callbacks are the documented exception.
- No pagination metadata for the fixed catalog.

## 2. Test fixtures

- New account `learner@example.test` with a known test password.
- Unknown email and second account for negative/cross-account tests.
- Valid, expired, malformed, wrong-signature, wrong-issuer, wrong-audience, and unsupported-algorithm JWT fixtures.
- Valid, expired, replayed, malformed, and wrong-provider OAuth handoff codes.
- Valid, expired, consumed/replayed, revoked, and unknown refresh-token records; Redis unavailable/evicted state. Include multiple access JWTs sharing one `sid`, active/deny-listed/expired/unknown `sid` values, TTL boundaries, and Redis outage for denylist reads/writes.
- Valid product with ID, name, description, finite price, uppercase currency, and nullable image URL.

Use non-production credentials and tokens only. Do not print credentials or tokens in CI logs.

## 3. API envelope and transport tests

### TC-API-001 — Envelope on success

For every JSON success, assert top-level `code`, `message`, `data`; HTTP status is authoritative and consistent. Do not add duplicate `success` or status fields.

### TC-API-002 — Envelope on errors

For API errors, assert the same envelope, stable code, useful safe message, and object/null `data` as appropriate.

### TC-API-003 — Content types

JSON endpoints use `application/json; charset=utf-8`. OAuth route redirects/callbacks are not forced into JSON.

### TC-API-004 — Status semantics

Success uses 200 or 201 as specified; do not return 200 for validation/authentication failure or 204 without the required envelope.

### TC-API-005 — No pagination

`GET /api/v1/products` returns no page/size/total/link metadata.

### TC-API-006 — Unsupported media/malformed body

Unsupported content type, truncated JSON, invalid encoding, JSON array/scalar instead of object, and empty body where required fail safely without side effects.

### TC-API-007 — Method mismatch

Unsupported methods return consistent 405/no mutation. GET/HEAD/OPTIONS never mutate products. TRACE is disabled.

### TC-API-008 — Security filter envelope

Trigger JWT parser and authorization failures before controller execution. Confirm Spring Security filter errors use the documented envelope, not framework HTML/default bodies.

### TC-API-009 — Safe errors

No stack traces, signing material, password hashes, provider raw responses, or credentials appear in errors or logs.

### TC-API-010 — Cache controls

Token-bearing responses and user-specific reads are not stored in shared caches. Verify appropriate `Cache-Control` headers.

## 4. JWS/JWT format and validation

### TC-JWT-001 — Three compact segments

Decode the JWT returned by sign-in. Assert exactly three dot-separated segments and that each segment uses Base64URL alphabet/decoding. Header and payload are readable JSON; signature validates.

### TC-JWT-002 — It is signed, not encrypted

Confirm the token follows signed compact JWS (`header.payload.signature`), not five-part JWE. UI explains Base64URL is encoding, not encryption, and does not display claims as secret.

### TC-JWT-003 — Supported signing algorithm only

Token header algorithm is exactly `HS256`; verify the signature as `Base64URL(HMAC-SHA256(secretKey, header-segment + '.' + payload-segment))`. Reject `alg: none`, empty/missing alg, every other algorithm, wrong key type, and algorithm-confusion attempts.

### TC-JWT-004 — Signature tampering

Alter header, payload, or signature independently. Protected endpoints return 401 and do not execute controller logic.

### TC-JWT-005 — Required claims

Require valid `iss`, `sub`, `aud`, `exp`, `iat`, `jti` (UUID v4 per access JWT), `sid` (UUID v4 per login session), and `token-type: access`. For this local learning setup, assert `iss` is `http://localhost:8080` and `aud` is `http://localhost:3000`. Refresh keeps the same `sid` and gets a new `jti`. Reject missing/invalid claims, future `iat`, expired tokens, malformed claim types, and any otherwise-valid signed access JWT that includes a `role` claim. Assert every token issued by the server omits `role`.

### TC-JWT-006 — Wrong issuer/audience/environment

Reject a correctly signed token issued for a different issuer, audience, or environment.

### TC-JWT-007 — Untrusted JOSE headers

Test unknown `kid`, path-like key ID, `jku`, `x5u`, embedded `jwk`, and control characters. Never fetch attacker-selected key URLs or interpret `kid` as a filesystem path.

### TC-JWT-008 — Oversized/ambiguous Authorization

Very large JWT/header, duplicate Authorization headers, combined multiple values, missing token after `Bearer`, wrong scheme, and whitespace variants fail safely and with bounded resource use.

### TC-JWT-009 — Forbidden role claim

Create an otherwise-valid access JWT containing a `role` claim and sign it with the valid test key. Reject it because `role` is forbidden by this contract. Assert server-issued access JWTs omit `role`; separately, reject payload tampering when the signature is not recomputed with the server key. Ignore identity/authority fields supplied in product bodies.

### TC-JWT-010 — Expiry boundary

Test immediately before/at/after `exp`, plus small configured clock skew. Expired JWT is rejected consistently.

### TC-JWT-011 — Client token storage

Access JWT exists only in JavaScript memory and transient Authorization headers; refresh token is set only in an HttpOnly, Secure, SameSite=Lax cookie with a 7-day lifetime; it is absent from JSON, localStorage, sessionStorage, IndexedDB, URLs, and logs.

### TC-JWT-012 — Reload and refresh lifecycle

Reload clears in-memory access JWT. A valid 7-day refresh cookie obtains a new access JWT with a fresh `jti` but the same `sid`, and rotates the refresh cookie; each new refresh token gets a fresh 7-day lifetime. Invalid/revoked refresh state requires sign-in.

### TC-JWT-013 — Logout lifecycle

Logout sends the access JWT, refresh cookie, and CSRF proof. If the access JWT has expired, the client silently refreshes first and then submits logout with a new access JWT and the same `sid`; no separate UI step is shown. Backend revokes the complete refresh-token family/session and deny-lists its `sid` until the latest access JWT in that session expires. Every JWT sharing the `sid` is rejected after normal signature/claim/time validation, and refresh using that `sid` is also rejected. Verify refresh and CSRF cookies are cleared only after successful logout.

## 5. UC-01 — Sign up

Endpoint: `POST /api/v1/auth/signup`; no JWT required.

### TC-SIGNUP-001 — Valid new account

Valid email/password returns 201 `CREATED` and safe user summary. No JWT or password/hash in response. User can sign in before backend restart.

### TC-SIGNUP-002 — Duplicate email

Exact duplicate returns 409 `EMAIL_ALREADY_REGISTERED`; no duplicate account is created.

### TC-SIGNUP-003 — Canonical email edge cases

Case variations, leading/trailing whitespace, Unicode, long email, missing `@`, multiple `@`, empty/null values. Confirm validation and normalization policy consistently avoids duplicate identities.

### TC-SIGNUP-004 — Password validation

Missing, empty, whitespace-only, too short, too long, Unicode, newline, and special characters. Apply documented bounds and do not echo input.

### TC-SIGNUP-005 — Untrusted extra properties

Submit `role`, `admin`, `userId`, `provider`, `passwordHash`, or status fields. Ignore/reject; caller cannot self-assign identity or privilege.

### TC-SIGNUP-006 — Concurrent duplicate registration

Submit simultaneous same-email registrations. At most one succeeds; others receive conflict; no corrupted in-memory account state.

### TC-SIGNUP-007 — In-memory reset

Create account, verify sign-in, restart backend, then verify account no longer exists as documented.

### TC-SIGNUP-009 — Process-local account scope

Create an account through one backend instance. A subsequent request to that same instance can sign in; a separate independent instance has no copy of the account. Do not describe the in-memory store as shared or durable.

### TC-SIGNUP-008 — No auth credential required

Sign-up succeeds without Authorization because this endpoint creates the account before authentication.

## 6. UC-02 — Sign in

Endpoint: `POST /api/v1/auth/signin`; no JWT required.

### TC-SIGNIN-001 — Valid credentials

Correct credentials return a 200 envelope with a signed 10-minute access JWT, JSON `tokenType: "Bearer"` (the Authorization scheme), expiry, safe user summary, and a 7-day refresh-token cookie. Assert the JWT payload separately contains `token-type: "access"` (token purpose); these values are distinct and must not be substituted.

### TC-SIGNIN-002 — Unknown email/wrong password

Both cases return generic 401 `INVALID_CREDENTIALS`; response does not reveal account existence.

### TC-SIGNIN-003 — Missing/invalid fields

Missing/null email/password, invalid email, wrong JSON types, and malformed JSON return 400; no JWT issued.

### TC-SIGNIN-004 — No JWT required to sign in

Valid login succeeds without Authorization header. Sign-in cannot require the JWT it is about to issue.

### TC-SIGNIN-005 — Refresh cookie issued

Inspect response headers: refresh token is set only as HttpOnly, Secure, SameSite=Lax cookie with a 7-day expiry; it is not returned in JSON. Access JWT is not placed in a cookie.

### TC-SIGNIN-006 — JWS claims

Validate HS256 signature and `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `sid`, and `token-type: access`. Assert `sid` is created on login, stays unchanged during refresh, and no `role` claim, provider token, or secret appears in payload.

### TC-SIGNIN-007 — In-memory account reset

After backend restart, prior in-memory account fails with generic credentials error.

## 7. UC-03/04 — Google and Facebook OAuth

Routes: Google `GET /oauth2/authorization/google`, callback `/login/oauth2/code/google`; Facebook equivalents. Run scenarios for both providers when credentials are configured.

### TC-OAUTH-001 — Start provider flow

Provider button opens the correct authorization route, expected client registration and minimal required scopes.

### TC-OAUTH-002 — OAuth state generated/validated

State is generated with `SecureRandom`, stored as a SHA-256-keyed record with a 5-minute TTL in local Redis, bound to the initiating browser with a short-lived HttpOnly SameSite=Lax nonce cookie, validated on callback, and atomically consumed once. Missing, tampered, expired, replayed, cross-browser, and cross-provider state is rejected. Redis is local to the single backend instance, not shared across instances.

### TC-OAUTH-003 — Success and account mapping

Successful provider auth maps by stable provider subject; provider and allowed profile claims appear in shop. No duplicate account on repeat login.

### TC-OAUTH-004 — Provider authorization code stays backend-side

Provider code is exchanged server-to-server and never forwarded to frontend or used as app bearer token.

### TC-OAUTH-005 — Provider token separation

Google/Facebook access token presented to app API is rejected unless explicitly supported (not in this contract).

### TC-OAUTH-006 — Consent denied/provider error

Deny consent or simulate provider 5xx/timeout at redirect, code exchange, user-info, and app-token issuance. User remains unauthenticated; no partial account/token state.

### TC-OAUTH-007 — Invalid provider configuration

Missing/wrong client ID/secret fails safely; no secret appears in error/log.

### TC-OAUTH-008 — Missing/unverified email

No email, unverified email, changed email, or mismatched identity follows explicit linking policy. Never merge accounts solely by unverified email.

### TC-OAUTH-009 — OAuth provider mix-up

Send Google response to Facebook callback and vice versa; validate issuer, registration, client ID, and provider identity; reject mismatch.

### TC-OAUTH-010 — Redirect allowlist

Malicious `returnUrl`, absolute URL, protocol-relative URL, encoded external URL, and Host-header manipulation cannot cause open redirect.

### TC-OAUTH-011 — Token leakage

JWT/provider token never appears in callback URL, query, fragment, logs, analytics, or referrer. Callback page uses no-store/no-referrer, no third-party assets, and removes handoff code from history promptly.

### TC-OAUTH-012 — Redis-backed OAuth state storage

The flow uses the local Redis state record and browser-binding nonce cookie described in the API contract; do not use Spring Security's default HttpSession authorization request repository. Verify cookies and browser binding are correct. Do not disable state validation.

## 8. UC-05 — OAuth handoff exchange

Endpoint: `POST /api/v1/auth/oauth/exchange`; no JWT yet.

### TC-HANDOFF-001 — Valid code exchange

Valid code returns 200 JSON envelope with app JWS and user summary. Code is consumed exactly once.

### TC-HANDOFF-002 — Expired/replayed/malformed code

Expired, already-used, random, altered, truncated, malformed, wrong-provider, or wrong-transaction code fails without issuing JWT.

### TC-HANDOFF-003 — Concurrent redemption

Redeem same code from two concurrent requests/workers; at most one receives credentials.

### TC-HANDOFF-004 — Popup postMessage

Callback posts code only to exact configured origin. Opener validates `event.origin`, `event.source`, and payload shape; unexpected origin/source is ignored.

### TC-HANDOFF-005 — Same-tab flow

If selected, callback redeems code once, then replaces URL so refresh/back does not expose/redeem it again.

### TC-HANDOFF-006 — Handoff store expiry/failure

Handoff code is generated with `SecureRandom`, stored by SHA-256 hash in local Redis for 60 seconds, and atomically consumed exactly once. Test TTL, concurrent redemption, Redis outage/eviction, and fail-closed behavior. Never store JWT signing key in Redis.

### TC-HANDOFF-007 — Exchange retry/network ambiguity

Network failure before redemption may retry within code lifetime. If code is consumed but response lost, fail safely and restart OAuth rather than issuing duplicate credentials.

## 9. UC-06 — Homepage and mock catalog

Endpoints: `GET /api/v1/homepage`, `GET /api/v1/products`; JWT required.

### TC-SHOP-001 — Valid bearer reads

Valid JWT returns safe homepage and product data in envelope.

### TC-SHOP-002 — Missing/invalid/expired bearer

Each protected GET returns 401 without data leak.

### TC-SHOP-003 — Fixed catalog/no pagination

Catalog is stable across requests/restart and has no pagination properties.

### TC-SHOP-004 — Read-only does not mutate

Repeated GET, HEAD, or OPTIONS does not add/hide products.

### TC-SHOP-005 — XSS-like display values

HTML/script-like text in product/user display fields is rendered escaped; no script execution.

## 10. UC-07 — Add product

Endpoint: `POST /api/v1/products`; JWT required.

### TC-ADD-001 — Valid add

Valid JWT and product receive 201 envelope. Frontend saves product locally only after successful response.

### TC-ADD-002 — Missing/invalid JWT

No Authorization, wrong scheme, expired/invalid signature, ambiguous duplicate headers return 401; no local state change.

### TC-ADD-003 — Field validation

Empty/overlong name, negative/missing/non-finite price, invalid currency, malformed/unsafe image URL, oversized description, invalid ID, wrong field types, and unexpected ownership/role fields are rejected safely.

### TC-ADD-004 — Duplicate ID/double submit

Repeat click, retry after timeout, or collide with seed/local ID. UI does not create duplicate/ambiguous cards; backend does not claim persistence.

### TC-ADD-005 — Backend outage/response mismatch

Network failure or malformed/non-success envelope does not update localStorage. If storage write fails after success, report local persistence failure accurately.

## 11. UC-08 — Hide product

Endpoint: `DELETE /api/v1/products/{productId}`; JWT required.

### TC-HIDE-001 — Hide seed/local product

Valid JWT receives success envelope; frontend records ID once and filters product out.

### TC-HIDE-002 — Missing/invalid JWT

Returns 401; local hidden IDs remain unchanged.

### TC-HIDE-003 — Malformed/unknown ID

Test encoded slash, overlong segment, invalid characters, traversal-like strings, and unknown IDs. Reject malformed input; do not claim database deletion.

### TC-HIDE-004 — Repeat/concurrent hide

Repeated or concurrent DELETE is handled consistently; hidden ID is stored once and UI remains stable.

### TC-HIDE-005 — Failure before acknowledgement

Network error, timeout, 4xx/5xx, or malformed envelope does not hide locally before success.

## 12. UC-10 — Refresh-token rotation

Endpoint: `POST /api/v1/auth/refresh`; no access JWT required. Refresh cookie and CSRF/origin proof required.

### TC-REFRESH-001 — Valid refresh rotates once

A valid current token returns a new 10-minute access JWT and sets a new opaque refresh cookie with a fresh 7-day lifetime. Redis contains the SHA-256 hash of the new token and records the old token as consumed; raw token is never stored.

### TC-REFRESH-002 — Old-token replay revokes family

After successful rotation from R1 to R2, presenting R1 again is detected as reuse. Backend revokes the complete token family/session and all refresh attempts in that family fail; no tokens are issued.

### TC-REFRESH-003 — Invalid/expired/revoked token

Unknown, malformed, expired, consumed, revoked, or sid-deny-listed refresh token returns 401 with no access token or replacement cookie. Refresh is checked through opaque-token/session state in Redis, not JWT signature/claims.

### TC-REFRESH-004 — Atomic rotation and concurrency

Concurrent refresh requests using the same token cannot both succeed. Client serializes refresh calls; server uses an atomic Redis operation/transaction and produces at most one replacement.

### TC-REFRESH-005 — Redis failure/eviction

If Redis is unavailable or required token state is missing, refresh fails closed and does not issue credentials. Verify key TTL does not exceed the session/token expiry.

### TC-REFRESH-006 — Double Submit Cookie scope and validation

Refresh and logout require the server-issued `XSRF-TOKEN` cookie plus matching `X-CSRF-TOKEN` header; reject missing, mismatched, unknown-hash, or wrong-session tokens. The token is a `SecureRandom` value stored by SHA-256 hash in Redis and is not signed. Return 403 `CSRF_INVALID` on failure. Business endpoints with Bearer JWT do not require CSRF token. Verify refresh/logout also enforce the configured origin/CORS policy.

### TC-REFRESH-007 — Token secrecy and hashing

Redis maps SHA-256 refresh-token hashes to session `sid` and stores session metadata plus a denylist keyed by `sid`; it never stores full JWTs. Raw refresh tokens do not appear in responses except the Set-Cookie value, application logs, traces, or error messages.

## 13. UC-09 — Logout

Endpoint: `DELETE /api/v1/auth/sessions`; access JWT, refresh cookie, and CSRF/origin proof are all required.

### TC-LOGOUT-001 — Valid logout

With a valid access JWT whose `sid` and `sub` match the refresh session, refresh cookie, and CSRF proof, returns 200; backend atomically revokes the entire refresh-token family/session, deny-lists its `sid` through the session's latest access-token `exp`, and clears refresh and CSRF cookies. Frontend clears its in-memory access JWT and navigates to sign-in. Product localStorage remains.

### TC-LOGOUT-002 — Missing/invalid refresh credential

Returns 401 for missing/invalid access JWT or refresh cookie, and 403 `CSRF_INVALID` for missing/invalid CSRF proof. Redis failures return 503 `SERVICE_UNAVAILABLE`; frontend must not report successful logout. Use 400 for malformed request input, not invalid authentication or CSRF proof.

### TC-LOGOUT-003 — Repeated logout

After a successful logout the client clears its JWT and cookies. A repeated request without the required access JWT/refresh cookie returns the documented authentication error; the UI remains signed out.

### TC-LOGOUT-004 — Old JWT after logout

After logout, refresh attempts fail because the session family is revoked. Every access JWT with the same `sid` is rejected, including older tokens not sent with logout. The `sid` denylist entry expires at the latest access-token `exp` for that session; expired tokens remain rejected by expiry validation after the entry is gone.

### TC-LOGOUT-005 — Denylist TTL boundary

Use a session with multiple access JWTs and known `iat`, `exp`, and current time. Confirm each token's time validity and maximum lifetime are checked. Assert Redis TTL for `deny:session:<sid>` equals the remaining time until the session's latest access-token `exp` (`max(0, latestSessionAccessExp - currentTime)`) and the entry is not retained beyond it.

### TC-LOGOUT-006 — Redis unavailable during logout

When Redis cannot atomically revoke the refresh session and write the `sid` denylist entry, logout returns 503 `SERVICE_UNAVAILABLE`, does not report success, and does not clear cookies as if revocation completed.

### TC-ADMIN-LOCK-001 — Lock account revokes all sessions

When an authorized admin lock event occurs, Redis marks the account locked, revokes every refresh-token family, and deny-lists every active session `sid` through that session's latest access-token `exp`. All access JWTs for every affected `sid` return 401 after signature/claims/time validation. New sign-in and refresh attempts fail until the account is unlocked. Admin endpoint and admin authorization details remain TBD.

## 14. Client token lifecycle and transport edge cases

### TC-CLIENT-001 — Access JWT memory-only

Access JWT is absent from cookies, localStorage, sessionStorage, IndexedDB, URL, and persistent logs.

### TC-CLIENT-002 — Refresh cookie transport

Refresh token is inaccessible to JavaScript, scoped to auth routes, sent only to the expected API origin, and absent from browser storage/URLs/logs. The refresh cookie is `HttpOnly; Secure; SameSite=Lax` with a 7-day expiry; the CSRF cookie is JavaScript-readable and session-bound.

### TC-CLIENT-003 — Reload and refresh

Reload loses the in-memory access JWT; a valid 7-day refresh cookie obtains a new pair and rotates; each newly issued refresh token receives a fresh 7-day lifetime. Invalid/revoked cookie state requires sign-in; local product state remains.

### TC-CLIENT-004 — Sign-out cleanup

The logout request includes the current Authorization Bearer token, refresh cookie, and CSRF header. After success, no stale Authorization header is sent; token references are removed from app state/interceptors.

### TC-CLIENT-005 — Token sent only to API origin

Never attach Authorization to image, analytics, provider, or arbitrary cross-origin URLs.

### TC-CLIENT-006 — Multiple tabs

Tokens remain tab-local; product localStorage is shared browser state and must not be described as user-owned server data.

### TC-CLIENT-007 — CORS/preflight

Disallowed origins cannot call protected endpoints; approved origin allows only required methods/headers. No arbitrary origin reflection.

### TC-CLIENT-008 — Request size/abuse

Huge JWT/header/body and high-rate invalid requests are rejected with bounded resource use. Consider rate limiting signup, signin, OAuth start, exchange, and product writes.

### TC-CLIENT-009 — Filter-chain error mapping

Security-filter failures use the standard API envelope; no framework HTML or stack trace on API routes.

## 15. Acceptance checklist

- Local signup/signin and OAuth exchange return a valid 10-minute signed three-segment JWS access token, validate its claims/signature, and set a 7-day refresh cookie.
- Refresh token is opaque Base64URL; Redis stores its SHA-256 hash and TTL-bound session state. Rotation is atomic and reuse revokes the family. Redis also stores session denylist entries by `sid` through the session's latest access-token `exp`, never full JWTs.
- Logout requires access JWT plus refresh cookie and CSRF; it revokes the entire refresh family and deny-lists the session `sid` through the latest access-token `exp`, rejecting all access JWTs in that session. Admin lock revokes every active session for the account the same way. Protected APIs fail closed if Redis cannot confirm denylist status.
- Refresh and logout enforce session-bound CSRF with a `SecureRandom` token stored by hash in Redis and matched from `XSRF-TOKEN`/`X-CSRF-TOKEN`; the CSRF token is not signed. Logout also requires Bearer access JWT. Business Bearer endpoints do not require CSRF.
- Protected business API requests require bearer access JWT; sign-up/sign-in/OAuth exchange/refresh are documented pre-access-token exceptions.
- OAuth state and one-time handoff exchange are covered; JWT never enters redirect URLs.
- Product operations update localStorage only after backend acknowledgement and do not imply server persistence.
- Account reset, fixed catalog, refresh/logout behavior, and response envelope match docs.

## 16. Open decisions affecting tests

1. Admin-lock API, admin authorization, account-unlock behavior, and lock-state persistence.
2. Email canonicalization and password bounds.
3. Product ID/decimal validation details.
4. Whether the refresh-token family also has an absolute maximum lifetime, and how long consumed-token markers are retained.
5. Rate limiting scope and cookie domain/path/CORS credential settings for deployment.
