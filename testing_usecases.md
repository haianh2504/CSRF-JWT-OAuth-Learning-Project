# Testing Use Cases — JWT OAuth Mock Shop

## 1. Purpose and baseline assumptions

This plan derives from `PRD.md`, `README.md`, `use_case.md`, and `api_contract.md`. It is a test specification, not evidence that code has been implemented or run.

- Protected business APIs use a signed compact JWS access JWT with exactly three Base64URL-encoded segments, a 10-minute lifetime, and JavaScript-memory-only client storage; it is not encrypted. Refresh tokens are opaque, not JWTs.
- Access JWTs use only HS256 (HMAC-SHA-256) and a 32-byte secret provisioned once with a cryptographically secure random generator; the same configured key is used across logins and restarts, with no signing-key rotation in this project. Only refresh tokens rotate. The key is never hardcoded, sent to the frontend, placed in a JWT, or stored in Redis.
- Each access JWT requires `iss`, `sub`, `aud`, `exp`, `iat`, `jti` (fresh UUID v4 per access token), `sid` (UUID v4 created once per successful login and unchanged across refresh), and `token-type: access`; never reuse `jti` or `sid`. The issuer must never emit a `role` claim, and the validator rejects any access JWT containing `role`, even when signed with the correct test/server key.
- Protected business endpoints require `Authorization: Bearer <access-JWT>`.
- Refresh uses a high-entropy opaque unpadded-Base64URL token with up to 7 days idle lifetime in an `HttpOnly; SameSite=Lax` cookie; `Secure` is off only for local HTTP and on for HTTPS. The refresh-token family expires 15 days after login, and refresh cannot extend it. Redis maps SHA-256 refresh-token hashes to `sid`, stores absolute session expiry and latest access-token `exp`, account-lock state and active-session indexes, plus a session denylist keyed by `sid` through latest `exp`; SHA-256 is one-way hashing, not encryption. Retain consumed-token hashes until their original expiry (maximum 7 days), bounded by family expiry. Never store complete JWTs or signing keys in Redis.
- Refresh rotation is atomic and single-use; replay of a consumed token before its original expiry revokes the family/session. After original expiry, replay is rejected as 401 but does not revoke an otherwise-live family. Refresh and logout require a session-bound CSRF token generated with `SecureRandom`; Redis stores its SHA-256 hash by `sid`, the frontend copies `XSRF-TOKEN` into `X-CSRF-TOKEN`, and the backend checks cookie/header equality and the session hash. The CSRF token is not signed. Logout additionally requires an access JWT. Business APIs require Bearer JWT; after signature, claims, expiry, and maximum session-age validation, they check session/denylist state in local Redis. They do not require CSRF tokens.
- Sign-up, sign-in, OAuth exchange, and refresh do not require a current access JWT.
- Sign-up, sign-in, and OAuth handoff exchange are pre-authentication endpoints and cannot require the app JWT they create.
- OAuth provider authorization code is exchanged backend-to-provider. OAuth uses a popup; the popup sends only a short-lived, one-time app handoff code to its opener, which exchanges it for the app JWT. The popup never receives the app JWT.
- No relational database and one backend instance only: a singleton backend in-memory user store holds accounts across requests within the Spring Boot process, then resets on restart. Redis is local to this backend and is not shared across backend instances. It holds refresh-token hashes mapped to `sid`, 15-day absolute session state, account lock state, active-session indexes, `sid` denylist entries through each session's latest access-token expiry, CSRF token hashes, 5-minute OAuth state hashes, and 60-second handoff-code hashes; successful state/handoff consumption atomically deletes the corresponding Redis record. It does not hold complete JWTs, signing keys, or raw OAuth state/handoff values. Catalog is fixed mock data; product mutations are acknowledged but not persisted on backend.
- Frontend stores accepted product additions and hidden IDs in `localStorage`; account data is backend-only, access JWT stays in memory, and 7-day refresh token is held only in the HttpOnly cookie; the `XSRF-TOKEN` cookie is intentionally readable by frontend JavaScript.
- JSON APIs use `{ "code", "message", "data" }`; OAuth redirects/callbacks are the documented exception.
- No pagination metadata for the fixed catalog.

## 2. Test fixtures

- New account `learner@example.test` with a known test password.
- Unknown email and second account for negative/cross-account tests.
- Valid, expired, malformed, wrong-signature, wrong-issuer, wrong-audience, and unsupported-algorithm JWT fixtures.
- OAuth fixtures: valid, missing, malformed, expired, replayed, cross-browser, and wrong-provider state; valid, expired, replayed, altered, and unknown handoff code; provider denial, 5xx, timeout, and Redis failure.
- Valid, expired, consumed/replayed, revoked, and unknown refresh-token records; Redis unavailable/evicted state. Include multiple access JWTs sharing one `sid`, active/deny-listed/expired/unknown `sid` values, TTL boundaries, and Redis outage for denylist reads/writes.
- Valid product with ID, name, description, finite price, uppercase currency, and nullable image URL.
- Multiple sessions for the same account, with distinct `sid` values and separate CSRF/refresh state.
- Malformed/legacy localStorage values, quota/security exceptions, and malformed API envelopes.

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

Access JWT exists only in JavaScript memory and transient Authorization headers; refresh token is set only in an HttpOnly SameSite=Lax cookie with `Secure=false` only for local HTTP and `Secure=true` for HTTPS, with expiry `min(now + 7 days, session absolute expiry)`; it is absent from JSON, localStorage, sessionStorage, IndexedDB, URLs, and logs.

### TC-JWT-012 — Reload and refresh lifecycle

Reload clears in-memory access JWT. A valid refresh cookie obtains a new access JWT with a fresh `jti` but same `sid`, and rotates the refresh cookie; each new refresh token gets up to 7 days idle lifetime, capped by the 15-day family expiry. At the family expiry, restore returns HTTP 401 and requires sign-in.

### TC-JWT-013 — Logout lifecycle

Logout sends the access JWT, refresh cookie, and CSRF proof. If the access JWT has expired, the client silently refreshes first and then submits logout with a new access JWT and the same `sid`; no separate UI step is shown. Backend revokes the complete refresh-token family/session and deny-lists its `sid` until the latest access JWT in that session expires. Every JWT sharing the `sid` is rejected after normal signature/claim/time validation, and refresh using that `sid` is also rejected. Verify refresh and CSRF cookies are cleared only after successful logout.

### TC-JWT-014 — Denylist lookup order and Redis outage

For malformed, bad-signature, wrong-issuer/audience, missing-claim, future-`iat`, and expired JWTs, reject before querying the session denylist. For a cryptographically and temporally valid JWT, query Redis by `sid` after validation; deny-listed `sid` returns 401. If Redis cannot be reached for a valid token, return 503 `SERVICE_UNAVAILABLE` and fail closed rather than accepting the request.

### TC-JWT-015 — Session identifier scope

Two successful sign-ins for the same account create different `sid` values and separate refresh/CSRF state. Refresh within either session preserves that session's `sid` and produces a fresh `jti`; logging out one session does not invalidate the other session.

## 5. UC-01 — Sign up

Endpoint: `POST /api/v1/auth/signup`; no JWT required.

### TC-SIGNUP-001 — Valid new account

Valid email/password returns 201 `CREATED` and safe user summary. No JWT or password/hash in response. User can sign in before backend restart.

### TC-SIGNUP-002 — Duplicate email

Exact duplicate returns 409 `EMAIL_ALREADY_REGISTERED`; no duplicate account is created.

### TC-SIGNUP-003 — Canonical email edge cases

Case variations, leading/trailing whitespace, Unicode, long email, missing `@`, multiple `@`, empty/null values. Confirm validation and normalization policy consistently avoids duplicate identities.

### TC-SIGNUP-004 — Password validation

Missing, empty, whitespace-only, too short, too long, Unicode, newline, and special characters. Until password bounds are specified, assert generic validation and no account side effect only; once bounds are chosen, assert the exact limits. Never echo input.

### TC-SIGNUP-005 — Untrusted extra properties

Submit `role`, `admin`, `userId`, `provider`, `passwordHash`, or status fields. Ignore/reject; caller cannot self-assign identity or privilege.

### TC-SIGNUP-006 — Concurrent duplicate registration

Submit simultaneous same-email registrations. At most one succeeds; others receive conflict; no corrupted in-memory account state.

### TC-SIGNUP-007 — In-memory reset

Create account, verify sign-in, restart backend, then verify account no longer exists as documented.

### TC-SIGNUP-008 — Process-local account scope

Create an account through one backend instance. A subsequent request to that same instance can sign in; a separate independent instance has no copy of the account. Do not describe the in-memory store as shared or durable.

### TC-SIGNUP-009 — No auth credential required

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

Inspect response headers: refresh token is set only as HttpOnly SameSite=Lax cookie with expiry `min(now + 7 days, session absolute expiry)`; `Secure` is disabled only for local HTTP and enabled for HTTPS. It is not returned in JSON. Access JWT is not placed in a cookie.

### TC-SIGNIN-006 — JWS claims

Validate HS256 signature and `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `sid`, and `token-type: access`. Assert `sid` is created on login, stays unchanged during refresh, and no `role` claim, provider token, or secret appears in payload.

### TC-SIGNIN-007 — In-memory account reset

After backend restart, prior in-memory account fails with generic credentials error.

### TC-SIGNIN-008 — Independent login sessions

Sign in twice as the same account. Each success creates a distinct `sid`, `jti`, refresh-token family, and per-session CSRF value. Confirm the first session remains usable until separately revoked; neither login overwrites the other's Redis session record.

## 7. UC-03/04 — Google and Facebook OAuth

Routes: Google `GET /oauth2/authorization/google`, callback `/login/oauth2/code/google`; Facebook equivalents. Run scenarios for both providers when credentials are configured.

### TC-OAUTH-001 — Start provider flow

Provider button opens a popup directly from the user gesture; disable duplicate OAuth starts while a popup is pending. Starting the flow returns HTTP 302 to the configured provider with exact registered callback, `response_type=code`, 32-byte random `state`, and PKCE S256 challenge. Verify state and browser-binding values are independent, contain no PII, are Base64URL without padding, and only their SHA-256 hashes are stored in Redis. State and browser-binding cookie expire within 5 minutes. If popup creation is blocked, retain the page and show a retryable message; make no OAuth request.

If Redis is unavailable while creating state, return HTTP 503; do not redirect to the provider or set a browser-binding cookie.

OAuth status matrix: provider start `302`; valid provider callback or safe provider/account error redirect `302`; invalid/missing/replayed state or missing code without a provider error `400` generic no-store page; Redis unavailable at start/callback/exchange `503`; provider rejection `502`; provider timeout `504`; server misconfiguration or unexpected internal failure `500`; successful handoff exchange `200`; missing/malformed exchange request `400`; unknown/expired/replayed/mismatched handoff `401`. OAuth redirects/callback pages are not JSON-envelope responses.

### TC-OAUTH-002 — OAuth state generated/validated

State is 32 random bytes from `SecureRandom`, Base64URL without padding, stored by SHA-256 hash with provider, exact callback, expiry, browser-binding hash, and PKCE verifier in local Redis for 5 minutes. The separate browser-binding value is 32 random bytes in an HttpOnly SameSite=Lax cookie (`Secure` only over HTTPS); never encode user or browser data into state. A valid provider callback returns HTTP 302 to the fixed frontend popup callback after state is atomically consumed and its Redis record deleted. Missing, malformed, mismatched, expired, replayed, cross-browser, or cross-provider state returns HTTP 400 with a generic no-store page and no account/session/credential side effects. Redis outage during lookup/consume returns HTTP 503. Redis is local to the single backend instance, not shared across instances.

### TC-OAUTH-003 — Success and account mapping

Successful provider auth maps by `(provider, stable subject)`; provider and allowed profile claims appear in shop. An already-linked identity signs into its existing account. A new provider identity with verified email and no existing account creates an account. A missing/unverified email or verified-email collision with an existing account returns a 302 to the fixed frontend callback with a safe `oauthError` code; do not auto-link by email. No duplicate account on repeat login.

### TC-OAUTH-004 — Provider authorization code stays backend-side

Provider code is exchanged server-to-server and never forwarded to frontend or used as app bearer token.

### TC-OAUTH-005 — Provider token separation

Google/Facebook access token presented to app API is rejected unless explicitly supported (not in this contract).

### TC-OAUTH-006 — Consent denied/provider error

Deny consent with a valid state: backend consumes/deletes state and returns 302 to the fixed frontend callback with `oauthError=access_denied`, no handoff code or session. Provider rejects token/profile exchange: HTTP 502; provider timeout: HTTP 504; Redis failure: HTTP 503. For all failures, assert no partial account/session/token state, no refresh/CSRF cookies, and a generic safe UI error.

### TC-OAUTH-007 — Invalid provider configuration

Missing client configuration fails before redirect with HTTP 500 `INTERNAL_ERROR`; invalid provider credentials fail at provider exchange with HTTP 502. No client secret appears in error, redirect, or log.

### TC-OAUTH-008 — Missing/unverified email

No email or unverified email returns 302 to the fixed frontend callback with a safe `oauthError=profile_not_eligible`. A verified provider email matching an existing local account returns 302 with `oauthError=account_link_required`; do not auto-link. A changed email still resolves an already-linked `(provider, stable subject)` to the same account. Assert no duplicate or merged account and no session/cookies on these rejected cases.

### TC-OAUTH-009 — OAuth provider mix-up

Send Google response to Facebook callback and vice versa; validate issuer, registration, client ID, state provider, PKCE transaction, and provider identity. Reject with HTTP 400, no redirect to an untrusted location, and no account/session/cookies.

### TC-OAUTH-010 — Redirect allowlist

Successful start and callback redirects return HTTP 302 only to the registered provider or exact configured frontend callback. Malicious `returnUrl`, absolute URL, protocol-relative URL, encoded external URL, and Host-header manipulation cannot change the target. Untrusted target attempts return HTTP 400 and create no session/code.

### TC-OAUTH-011 — Token leakage

App JWT and provider tokens never appear in callback URL, query, fragment, logs, analytics, referrer, or `postMessage`. Only the short-lived app handoff code appears as `?handoff=` in the frontend popup callback URL; the provider's `?code=` remains backend-only. Callback uses no-store/no-referrer and no third-party assets; copy `handoff` to memory and remove it from popup history before `postMessage`. The opener accepts `{ type: "OAUTH_HANDOFF", code }` only from the exact frontend origin and the popup window it opened.

### TC-OAUTH-012 — Redis-backed OAuth state storage

The flow uses the local Redis state record and browser-binding cookie described in the API contract; do not use Spring Security's default HttpSession authorization request repository. Verify state, cookie binding, PKCE S256 verifier, exact callback, and record deletion after valid consumption. A Redis outage returns HTTP 503; no OAuth account, handoff code, access token, or auth cookie is created. Do not disable state validation.

### TC-OAUTH-013 — Callback side effects and state-cookie cleanup

Missing, malformed, mismatched, expired, replayed, or cross-browser state returns HTTP 400; valid state with Redis unavailable returns HTTP 503. No failure creates/links an account, creates a session, issues a handoff code, or sets auth cookies. A valid state is atomically consumed and deleted exactly once. Clear the browser-binding cookie using the same path/domain attributes after a completed callback; an expired Redis record is removed by TTL.

## 8. UC-05 — OAuth handoff exchange

Endpoint: `POST /api/v1/auth/oauth/exchange`; no JWT yet.

### TC-HANDOFF-001 — Valid code exchange

Valid handoff code returns HTTP 200 JSON envelope with app JWS and safe user summary, creates a new `sid` with 15-day absolute expiry, stores session/CSRF state, and sets refresh and CSRF cookies. In the same atomic Redis operation, successfully consume and delete the handoff record. The code is absent from response JSON except as the submitted request value.

### TC-HANDOFF-002 — Expired/replayed/malformed code

Missing code, non-string/empty `code`, or malformed JSON/request shape returns HTTP 400 `VALIDATION_ERROR`. Expired, already-used, random, altered, truncated, wrong-length, wrong-transaction, or unknown non-empty string code returns HTTP 401 `UNAUTHENTICATED` with the same generic response. None issues JWT or sets/rotates cookies. Do not distinguish expired, replayed, or unknown code in message/body.

### TC-HANDOFF-003 — Concurrent redemption

Redeem the same code concurrently: exactly one request returns HTTP 200 and creates a session; the other returns HTTP 401 `UNAUTHENTICATED`. Redis has no remaining code record after the successful exchange; no second session/cookie pair is issued.

### TC-HANDOFF-004 — Popup postMessage

Popup callback copies `handoff` to memory, removes that query parameter from its URL, then posts only the handoff code to the exact configured frontend origin. Opener validates `event.origin`, `event.source`, request state, and payload shape; unexpected origin/source is ignored and causes no exchange request. Popup closes only after opener acknowledgement.

### TC-HANDOFF-005 — Popup handoff and URL cleanup

The selected popup callback removes the handoff code from address bar/history before `postMessage`; the opener exchanges it once. Reload/back cannot expose or redeem the code a second time. If exchange returns 401, show a safe recoverable error and restart OAuth. If the code was consumed but the response was lost, restart OAuth; never assume login succeeded.

### TC-HANDOFF-006 — Handoff store expiry/failure

Handoff code is 32 `SecureRandom` bytes encoded as unpadded Base64URL; local Redis stores only the SHA-256 hash and verified account/provider reference for 60 seconds. A successful exchange atomically consumes and deletes the record. Redis outage returns HTTP 503 `SERVICE_UNAVAILABLE`; expired/evicted/unknown records return HTTP 401; unexpected signing/session-creation failure returns HTTP 500 `INTERNAL_ERROR` without a successful auth response. Never store JWT signing key or raw code in Redis.

### TC-HANDOFF-007 — Exchange retry/network ambiguity

Network failure before the exchange reaches backend may retry within the 60-second TTL. If the backend consumed/deleted the code but the response was lost, retry returns HTTP 401 and the user restarts OAuth; do not issue duplicate credentials or assume a session exists.

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

### TC-SHOP-006 — Authentication context endpoint

For `GET /api/v1/auth/sessions`, a valid bearer token returns only the documented safe user summary, `authMode`, and access-token expiry. Never return access/refresh tokens, hashes, `sid`, signing material, or provider tokens. Missing, invalid, expired, or deny-listed tokens return the documented authentication error; the read-only endpoint causes no state change.

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

### TC-ADD-006 — Corrupt or unavailable localStorage

Malformed JSON, unexpected value shapes, and `localStorage` read/write exceptions do not crash the UI or corrupt server responses. Do not show a product as durably saved when browser persistence fails; only write after API success.

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

### TC-HIDE-006 — Corrupt or unavailable localStorage

Malformed hidden-ID JSON, non-string entries, or browser storage exceptions do not crash rendering. A failed API request must not add the ID locally; if the API succeeds but persistence fails, report that the hide may not survive reload.

### TC-HIDE-007 — Unknown but well-formed ID

Separate a syntactically malformed ID from a well-formed ID absent from the fixed catalog. Assert the documented malformed-ID response. The expected response for an unknown valid ID is still a contract decision; do not assume 404 or success until specified, and do not claim a server record was deleted.

## 12. UC-10 — Refresh-token rotation

Endpoint: `POST /api/v1/auth/refresh`; no access JWT required. Refresh cookie and CSRF/origin proof required.

### TC-REFRESH-001 — Valid refresh rotates once

A valid current token returns HTTP 200, a new access JWT expiring at `min(now + 10 minutes, session absolute expiry)`, and a new opaque refresh cookie expiring at `min(now + 7 days, session absolute expiry)`. Redis contains the new token hash and a consumed marker for the old hash through the old token's original expiry; raw token is never stored.

### TC-REFRESH-002 — Old-token replay revokes family

After rotation from R1 to R2, presenting R1 before R1's original `exp` returns HTTP 401 and revokes the complete family/session; subsequent R2 refresh also returns HTTP 401. Redis removes the R1 consumed marker at its TTL. A replay after R1's original expiry returns HTTP 401 as expired but does not revoke a still-valid family, because R1 could no longer refresh.

### TC-REFRESH-003 — Invalid/expired/revoked token

Missing/malformed request shape returns HTTP 400 `VALIDATION_ERROR`; unknown, expired, consumed-before-expiry, revoked, absolute-session-expired, or sid-deny-listed refresh token returns HTTP 401 `UNAUTHENTICATED` with no access token or replacement cookie. If the consumed marker proves replay before original token expiry, revoke the family. Refresh is checked through opaque-token/session state in Redis, not JWT signature/claims.

### TC-REFRESH-004 — Atomic rotation and concurrency

Concurrent refresh requests using the same token cannot both succeed. Client serializes refresh calls; server uses an atomic Redis operation/transaction and produces at most one replacement.

### TC-REFRESH-005 — Redis failure/eviction

If Redis is unavailable, refresh returns HTTP 503 `SERVICE_UNAVAILABLE`; missing/evicted required token state returns HTTP 401 `UNAUTHENTICATED`. Both fail closed and issue no credentials. Verify active and consumed-marker TTLs do not exceed their token/session expiry.

### TC-REFRESH-006 — Double Submit Cookie scope and validation

Refresh and logout require the server-issued `XSRF-TOKEN` cookie plus matching `X-CSRF-TOKEN` header; reject missing, mismatched, unknown-hash, or wrong-session tokens with HTTP 403 `CSRF_INVALID` before token mutation. The token is a `SecureRandom` value stored by SHA-256 hash in Redis and is not signed. Business endpoints with Bearer JWT do not require CSRF token. With the current Next.js rewrite proxy, browser calls are same-origin and CORS is not needed; if direct browser-to-backend calls are enabled, test exact-origin credentialed CORS and reject wildcard origin.

### TC-REFRESH-007 — Token secrecy and hashing

Redis maps SHA-256 refresh-token hashes to session `sid` and stores session metadata plus a denylist keyed by `sid`; it never stores full JWTs. Raw refresh tokens do not appear in responses except the Set-Cookie value, application logs, traces, or error messages.

### TC-REFRESH-008 — CSRF rejection has no token side effects

Missing, mismatched, or wrong-session CSRF proof returns HTTP 403 `CSRF_INVALID` before rotation. The current refresh token remains usable with valid CSRF proof; no replacement is issued, no token is marked consumed, and no family is revoked solely because CSRF validation failed.

### TC-REFRESH-009 — Expired access recovery retries once

When a protected request returns 401 because the access JWT expired, refresh once, retry the original request once with the new JWT, and stop if the retry fails. Concurrent requests share/serialize refresh so they do not replay the same refresh token; invalid refresh or refresh 503 does not cause an infinite retry loop.

### TC-REFRESH-010 — Fifteen-day absolute family expiry

At login, record `sessionExpiresAt = loginTime + 15 days`. Repeated refresh near day 15 never extends that instant; each refresh cookie gets `min(now + 7 days, sessionExpiresAt)` and each access JWT gets `min(now + 10 minutes, sessionExpiresAt)`. At/after absolute expiry, refresh returns HTTP 401 `UNAUTHENTICATED`, issues no token/cookie, and protected access tokens are expired. Verify the session/refresh Redis keys do not outlive the absolute expiry.

### TC-REFRESH-011 — Consumed-token replay marker lifetime

For each rotated token, retain only its SHA-256 consumed marker until its original token `exp`, at most 7 days and never beyond the 15-day family expiry. Replay before original `exp` returns HTTP 401 and revokes the family; after original `exp`, it returns HTTP 401 without revoking an otherwise-active family. Two-hour marker expiry is insufficient and must not be used.

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

### TC-LOGOUT-007 — Session/account mismatch

Present a valid access JWT with a refresh cookie/CSRF value from a different session, then a token with a different `sub`. Reject without revoking either unrelated session, writing a denylist entry for the wrong `sid`, or clearing cookies as if logout succeeded.

### TC-LOGOUT-008 — Logout is scoped to one session

With two active `sid` values for one account, logging out one session denies every access JWT and refresh family under that `sid`, while the other session remains usable. This distinguishes per-session logout from account-wide admin lock.

### TC-LOGOUT-009 — Logout versus concurrent refresh

Race logout and refresh for the same session. Redis serialization must produce a safe outcome: either refresh completes first and logout revokes the resulting family/session, or logout completes first and refresh is rejected. No access or refresh token remains usable after confirmed logout.

### TC-LOGOUT-010 — Expired access and refresh failure

If the access token is already expired, the client silently refreshes before sending logout. If refresh fails, do not send logout with the expired token, do not clear cookies or local auth state as if logout succeeded, and keep a retryable UI error. If refresh succeeds, logout uses the new access token with the same `sid`.

### TC-ADMIN-LOCK-001 — Lock account revokes all sessions

When an authorized admin lock event occurs, Redis marks the account locked, revokes every refresh-token family, and deny-lists every active session `sid` through that session's latest access-token `exp`. All access JWTs for every affected `sid` return 401 after signature/claims/time validation. New sign-in and refresh attempts fail until the account is unlocked. Admin endpoint and admin authorization details remain TBD.

### TC-ADMIN-LOCK-002 — Lock with no sessions and lock/refresh race

Locking an account with no active sessions still blocks subsequent sign-in and refresh. Race account lock with sign-in/refresh; after the lock operation takes effect, no new access JWT or refresh token may be issued. The active-session index and lock state remain consistent.

## 14. Client token lifecycle and transport edge cases

### TC-CLIENT-001 — Access JWT memory-only

Access JWT is absent from cookies, localStorage, sessionStorage, IndexedDB, URL, and persistent logs.

### TC-CLIENT-002 — Refresh cookie transport

Refresh token is inaccessible to JavaScript, scoped to auth routes, sent only through the same-origin Next.js proxy, and absent from browser storage/URLs/logs. The refresh cookie is `HttpOnly; SameSite=Lax`, with `Secure` disabled only for local HTTP and enabled for HTTPS; expiry is capped by both 7 idle days and session absolute expiry. The CSRF cookie is JavaScript-readable and session-bound.

### TC-CLIENT-003 — Reload and refresh

Reload loses the in-memory access JWT; a valid refresh cookie obtains a new pair and rotates; each new refresh token receives up to 7 days idle lifetime, capped by the session's 15-day absolute expiry. Invalid/revoked/expired family state requires sign-in; local product state remains.

### TC-CLIENT-004 — Sign-out cleanup

The logout request includes the current Authorization Bearer token, refresh cookie, and CSRF header. After success, no stale Authorization header is sent; token references are removed from app state/interceptors.

### TC-CLIENT-005 — Token sent only to API origin

Never attach Authorization to image, analytics, provider, or arbitrary cross-origin URLs.

### TC-CLIENT-006 — Multiple tabs

Tokens remain tab-local; product localStorage is shared browser state and must not be described as user-owned server data.

### TC-CLIENT-007 — CORS/preflight

Through the documented Next.js rewrites, browser API calls remain same-origin and do not use CORS; verify proxy forwards request cookies and preserves `Set-Cookie`. If direct browser-to-backend calls are enabled, only exact configured origins are allowed with credentials; preflight allows only required methods/headers and `Authorization`, `Content-Type`, and `X-CSRF-TOKEN`. Reject wildcard origins and arbitrary origin reflection.

### TC-CLIENT-008 — Request size/abuse

Huge JWT/header/body and high-rate invalid requests are rejected with bounded resource use. Consider rate limiting signup, signin, OAuth start, exchange, and product writes.

### TC-CLIENT-009 — Filter-chain error mapping

Security-filter failures use the standard API envelope; no framework HTML or stack trace on API routes.

### TC-CLIENT-010 — Cookie expiration and logout cleanup

Verify successful logout expires both refresh and CSRF cookies using the same names/path/domain attributes used when setting them. Failed logout leaves them intact. Browser does not expose the HttpOnly refresh token to JavaScript, and no access/refresh/CSRF value appears in URLs, logs, or the request inspector.

### TC-CLIENT-011 — Malformed local browser state

Seed invalid JSON, wrong types, and duplicate IDs in local product/hidden-ID storage. Initial load remains usable, invalid entries are ignored or safely reset, and no local value is treated as server-authoritative.

### TC-CLIENT-012 — Session restore states

With no `XSRF-TOKEN` cookie, initial load reaches sign-in without a stuck loading state. With a valid refresh cookie, restore silently obtains a new access JWT. Invalid/revoked refresh returns to sign-in with a safe message; Redis 503 shows a retryable service error and does not pretend the session was restored.

### TC-CLIENT-013 — Authentication form pending and failure states

Empty/invalid form data is rejected before sending a request. While sign-in/sign-up is pending, disable duplicate submission. After submission clear the password field; on failure retain the email, show an accessible error, and do not enter the shop. A successful sign-up switches to sign-in without auto-authenticating.

### TC-CLIENT-014 — Shop load failure after authentication

If sign-in succeeds but homepage/catalog loading fails, preserve the valid in-memory session and offer retry without asking the user to sign in again. Retry does not duplicate the sign-in request; a successful retry enters the shop.

### TC-CLIENT-015 — Product mutation pending and failure UI

While adding/hiding, disable duplicate action for the relevant form/item. On API failure retain the dialog fields or product card and show a retryable error; on success update local UI only after acknowledgement. Keep loading, empty, and error states distinguishable.

### TC-CLIENT-016 — OAuth callback code handling

On popup callback, remove the handoff code from visible URL/history before `postMessage`; opener verifies origin/source and exchanges it once. Malformed/expired code shows a recoverable error without exposing code or provider details. Close popup only after opener acknowledgement.

## 15. Acceptance checklist

- Local signup/signin and OAuth exchange return a valid signed three-segment JWS access token with lifetime up to 10 minutes, validate its claims/signature, and set a refresh cookie with up to 7 days idle lifetime.
- Refresh token is opaque Base64URL; Redis stores its SHA-256 hash and TTL-bound session state. Session family lifetime is capped at 15 days from login; refresh cannot extend it. Rotation is atomic; consumed hashes are retained until original token expiry (up to 7 days) and replay before that expiry revokes the family. Redis also stores session denylist entries by `sid` through latest access-token `exp`, never full JWTs.
- Logout requires access JWT plus refresh cookie and CSRF; it revokes the entire refresh family and deny-lists the session `sid` through the latest access-token `exp`, rejecting all access JWTs in that session. Admin lock revokes every active session for the account the same way. Protected APIs fail closed if Redis cannot confirm denylist status.
- Refresh and logout enforce session-bound CSRF with a `SecureRandom` token stored by hash in Redis and matched from `XSRF-TOKEN`/`X-CSRF-TOKEN`; the CSRF token is not signed. Logout also requires Bearer access JWT. Business Bearer endpoints do not require CSRF.
- Protected business API requests require bearer access JWT; sign-up/sign-in/OAuth exchange/refresh are documented pre-access-token exceptions.
- `GET /api/v1/auth/sessions` returns only its documented safe auth context and is covered for missing/invalid/revoked credentials.
- Denylist lookup happens only after valid JWT signature, claims, and time checks; valid tokens fail closed with 503 if Redis cannot confirm their session status.
- CSRF rejection does not consume/rotate refresh tokens or report logout success; a failed logout preserves client auth state for retry.
- OAuth popup flow verifies 32-byte random state, browser binding, PKCE S256, provider/error redirects, one-time handoff, exact-origin/source `postMessage`, and exact HTTP statuses. State records are deleted after valid callback consumption; handoff records are deleted after successful exchange. App JWT never enters redirect URLs or `postMessage`.
- Product operations update localStorage only after backend acknowledgement and do not imply server persistence.
- Malformed/unavailable localStorage does not crash the UI or cause unacknowledged product changes to appear persisted.
- Account reset, fixed catalog, refresh/logout behavior, and response envelope match docs.

## 16. Open decisions affecting tests

1. Admin-lock API, admin authorization, account-unlock behavior, and lock-state persistence.
2. Exact email canonicalization and password length/character bounds.
3. Product ID/decimal constraints and response policy for well-formed but unknown product IDs.
4. Rate limiting scope.
5. Verify production Vercel proxy forwards cookies and `Set-Cookie`; confirm production callback allowlist, cookie `Domain`/`Path`, and whether a shared custom domain or same-origin proxy will be used. Local Next.js proxy is same-origin; CORS is needed only if browser calls backend directly.
