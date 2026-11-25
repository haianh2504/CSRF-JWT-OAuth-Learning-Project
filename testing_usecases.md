# Testing Use Cases — JWT OAuth Mock Shop

## 1. Purpose and baseline assumptions

This plan derives from `PRD.md`, `README.md`, `use_case.md`, and `api_contract.md`. It is a test specification, not evidence that code has been implemented or run.

- Protected business APIs use a signed compact JWS access JWT with exactly three Base64URL-encoded segments, a 10-minute lifetime, and JavaScript-memory-only client storage; it is not encrypted.
- Protected business endpoints require `Authorization: Bearer <access-JWT>`.
- Refresh uses a high-entropy opaque unpadded-Base64URL token with a 7-day lifetime in an `HttpOnly; Secure; SameSite=Lax` cookie. Redis stores only SHA-256 hashes, expiry, and session/token-family state; SHA-256 is one-way hashing, not encryption.
- Refresh rotation is atomic and single-use; reuse of an already consumed token revokes its family/session. Only refresh/logout require signed, session-bound Double Submit Cookie CSRF validation: frontend copies the `XSRF-TOKEN` cookie into `X-CSRF-TOKEN`; business APIs do not require CSRF tokens.
- Sign-up, sign-in, OAuth exchange, and refresh do not require a current access JWT.
- Sign-up, sign-in, and OAuth handoff exchange are pre-authentication endpoints and cannot require the app JWT they create.
- OAuth provider authorization code is exchanged backend-to-provider. Frontend receives only a short-lived, one-time app handoff code, then exchanges it for the app JWT.
- No relational database: a singleton backend in-memory user store (for example, `ConcurrentHashMap`) holds accounts across requests within one Spring Boot process, then resets on restart; separate backend instances do not share accounts. It stores account ID, normalized email, BCrypt password hash, and OAuth provider identity mapping, never raw passwords. Redis holds only refresh-token hashes and session state. Catalog is fixed mock data; product mutations are acknowledged but not persisted on backend.
- Frontend stores accepted product additions and hidden IDs in `localStorage`; account data is backend-only, access JWT stays in memory, and 7-day refresh token is held only in the HttpOnly cookie; the `XSRF-TOKEN` cookie is intentionally readable by frontend JavaScript.
- JSON APIs use `{ "code", "message", "data" }`; OAuth redirects/callbacks are the documented exception.
- No pagination metadata for the fixed catalog.

## 2. Test fixtures

- New account `learner@example.test` with a known test password.
- Unknown email and second account for negative/cross-account tests.
- Valid, expired, malformed, wrong-signature, wrong-issuer, wrong-audience, and unsupported-algorithm JWT fixtures.
- Valid, expired, replayed, malformed, and wrong-provider OAuth handoff codes.
- Valid, expired, consumed/replayed, revoked, and unknown refresh-token records; Redis unavailable/evicted state.
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

Token header algorithm matches the explicitly configured algorithm. Reject `alg: none`, empty/missing alg, unsupported algorithm, wrong key type, and algorithm-confusion attempts.

### TC-JWT-004 — Signature tampering

Alter header, payload, or signature independently. Protected endpoints return 401 and do not execute controller logic.

### TC-JWT-005 — Required claims

Reject missing/invalid subject, expiration, issued-at, issuer, audience, or token identifier where required by final policy. Reject future `iat`, expired tokens, and malformed claim types.

### TC-JWT-006 — Wrong issuer/audience/environment

Reject a correctly signed token issued for a different issuer, audience, or environment.

### TC-JWT-007 — Untrusted JOSE headers

Test unknown `kid`, path-like key ID, `jku`, `x5u`, embedded `jwk`, and control characters. Never fetch attacker-selected key URLs or interpret `kid` as a filesystem path.

### TC-JWT-008 — Oversized/ambiguous Authorization

Very large JWT/header, duplicate Authorization headers, combined multiple values, missing token after `Bearer`, wrong scheme, and whitespace variants fail safely and with bounded resource use.

### TC-JWT-009 — Identity/authority tampering

Modify subject, email, provider, or role claims and re-sign with an invalid key. Reject. Ignore identity/authority fields supplied in product bodies.

### TC-JWT-010 — Expiry boundary

Test immediately before/at/after `exp`, plus small configured clock skew. Expired JWT is rejected consistently.

### TC-JWT-011 — Client token storage

Access JWT exists only in JavaScript memory and transient Authorization headers; refresh token is set only in an HttpOnly, Secure, SameSite=Lax cookie with a 7-day lifetime; it is absent from JSON, localStorage, sessionStorage, IndexedDB, URLs, and logs.

### TC-JWT-012 — Reload and refresh lifecycle

Reload clears in-memory access JWT. A valid 7-day refresh cookie obtains a new access JWT and rotates the refresh cookie; each newly issued refresh token gets a fresh 7-day lifetime; invalid/revoked refresh state requires sign-in.

### TC-JWT-013 — Logout lifecycle

Logout revokes the refresh-token family/session and clears refresh and CSRF cookies. Previously issued access JWT may remain valid for up to 10 minutes from issuance; verify UI does not claim immediate access-token revocation.

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

Correct credentials return 200 envelope with 10-minute access token type `Bearer`, expiry, signed compact JWS, safe user summary, and a 7-day refresh-token cookie.

### TC-SIGNIN-002 — Unknown email/wrong password

Both cases return generic 401 `INVALID_CREDENTIALS`; response does not reveal account existence.

### TC-SIGNIN-003 — Missing/invalid fields

Missing/null email/password, invalid email, wrong JSON types, and malformed JSON return 400; no JWT issued.

### TC-SIGNIN-004 — No JWT required to sign in

Valid login succeeds without Authorization header. Sign-in cannot require the JWT it is about to issue.

### TC-SIGNIN-005 — Refresh cookie issued

Inspect response headers: refresh token is set only as HttpOnly, Secure, SameSite=Lax cookie with a 7-day expiry; it is not returned in JSON. Access JWT is not placed in a cookie.

### TC-SIGNIN-006 — JWS claims

Validate signature, expiry, issuer/audience/subject and other claims per final policy. No provider token or secret in payload.

### TC-SIGNIN-007 — In-memory account reset

After backend restart, prior in-memory account fails with generic credentials error.

## 7. UC-03/04 — Google and Facebook OAuth

Routes: Google `GET /oauth2/authorization/google`, callback `/login/oauth2/code/google`; Facebook equivalents. Run scenarios for both providers when credentials are configured.

### TC-OAUTH-001 — Start provider flow

Provider button opens the correct authorization route, expected client registration and minimal required scopes.

### TC-OAUTH-002 — OAuth state generated/validated

State is unpredictable, bound to initiating flow, validated on callback, and consumed once. Missing, tampered, expired, replayed, cross-browser, and cross-provider state is rejected.

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

### TC-OAUTH-012 — Default Spring OAuth state storage

Spring Security default authorization request repository stores OAuth request in HttpSession. Verify actual `Set-Cookie`; decide whether a transient OAuth-only session is allowed or configure a secure alternative. Do not disable state validation to avoid the cookie.

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

Expired state is cleaned. If Redis is used, test TTL, atomic consumption, outage/eviction and fail-closed behavior. Never store JWT signing key in Redis.

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

Unknown, malformed, expired, consumed, or revoked refresh token returns 401 with no access token or replacement cookie.

### TC-REFRESH-004 — Atomic rotation and concurrency

Concurrent refresh requests using the same token cannot both succeed. Client serializes refresh calls; server uses an atomic Redis operation/transaction and produces at most one replacement.

### TC-REFRESH-005 — Redis failure/eviction

If Redis is unavailable or required token state is missing, refresh fails closed and does not issue credentials. Verify key TTL does not exceed the session/token expiry.

### TC-REFRESH-006 — Double Submit Cookie scope and validation

Refresh and logout require the server-issued `XSRF-TOKEN` cookie plus matching `X-CSRF-TOKEN` header; reject missing, mismatched, invalidly signed, or wrong-session tokens. Business endpoints with Bearer JWT do not require CSRF token. Verify refresh/logout also enforce the configured origin/CORS policy.

### TC-REFRESH-007 — Token secrecy and hashing

Redis stores only SHA-256 token hashes and minimal session metadata. Raw refresh tokens do not appear in responses except the Set-Cookie value, application logs, traces, or error messages.

## 13. UC-09 — Logout

Endpoint: `DELETE /api/v1/auth/sessions`; refresh cookie and CSRF/origin proof required; access JWT is optional.

### TC-LOGOUT-001 — Valid logout

Returns 200 envelope; backend revokes the current refresh-token family/session in Redis and clears refresh and CSRF cookies. Frontend clears in-memory access JWT and navigates to sign-in. Product localStorage remains.

### TC-LOGOUT-002 — Missing/invalid refresh credential

Returns 401 for missing/invalid refresh cookie and 403 for missing/invalid CSRF proof; UI reports logout only according to the API result.

### TC-LOGOUT-003 — Repeated logout

Repeated logout after client clears token is handled gracefully and consistently.

### TC-LOGOUT-004 — Old JWT after logout

After logout, refresh attempts fail because the session is revoked. A copied access JWT may remain valid for up to 10 minutes from issuance; verify it is rejected after expiry.

## 14. Client token lifecycle and transport edge cases

### TC-CLIENT-001 — Access JWT memory-only

Access JWT is absent from cookies, localStorage, sessionStorage, IndexedDB, URL, and persistent logs.

### TC-CLIENT-002 — Refresh cookie transport

Refresh token is inaccessible to JavaScript, scoped to auth routes, sent only to the expected API origin, and absent from browser storage/URLs/logs. The refresh cookie is `HttpOnly; Secure; SameSite=Lax` with a 7-day expiry; the CSRF cookie is JavaScript-readable and session-bound.

### TC-CLIENT-003 — Reload and refresh

Reload loses the in-memory access JWT; a valid 7-day refresh cookie obtains a new pair and rotates; each newly issued refresh token receives a fresh 7-day lifetime. Invalid/revoked cookie state requires sign-in; local product state remains.

### TC-CLIENT-004 — Sign-out cleanup

No stale Authorization header is sent after logout; token references removed from app state/interceptors.

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
- Refresh token is opaque Base64URL; Redis stores only its SHA-256 hash and TTL-bound session state. Rotation is atomic and reuse revokes the family.
- Logout revokes refresh state; access JWT remains valid no longer than 10 minutes from issuance.
- Only cookie-authenticated refresh/logout routes enforce signed, session-bound Double Submit Cookie using the `XSRF-TOKEN` cookie and matching `X-CSRF-TOKEN` header.
- Protected business API requests require bearer access JWT; sign-up/sign-in/OAuth exchange/refresh are documented pre-access-token exceptions.
- OAuth state and one-time handoff exchange are covered; JWT never enters redirect URLs.
- Product operations update localStorage only after backend acknowledgement and do not imply server persistence.
- Account reset, fixed catalog, refresh/logout behavior, and response envelope match docs.

## 16. Open decisions affecting tests

1. Signing algorithm, issuer, audience, expiry, and key rotation policy.
2. OAuth popup versus same-tab UX.
3. Whether OAuth-only transient HttpSession/cookie is allowed or custom state storage is required.
4. In-memory versus Redis TTL store for OAuth handoff codes.
5. Email canonicalization and password bounds.
6. Product ID/decimal validation details.
7. Whether the refresh-token family also has an absolute maximum lifetime, and how long consumed-token markers are retained.
8. Rate limiting scope and cookie domain/path/CORS credential settings for deployment.
