# Testing Use Cases — CSRF_JWT_OAuth Shop

## 1. Purpose

This document defines manual and automated test scenarios derived from the current `PRD.md`, `README.md`, `use_case.md`, and `api_contract.md`. It covers the user-facing flows, HTTP contract, token handling, mock shop state, and low-probability boundary/error cases.

These are test specifications, not evidence that the implementation has been built or run. OAuth token delivery uses a short-lived, single-use application handoff code exchanged at `POST /api/v1/auth/oauth/exchange`; popup versus same-tab presentation remains a UI choice.

## 2. System assumptions under test

- Authentication is JWT-only. There is no session cookie.
- The backend returns an application JWT after local sign-in. The frontend keeps JWT in memory and sends `Authorization: Bearer <JWT>` to protected endpoints.
- Authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require both the JWT header and `X-CSRF-TOKEN`. The backend validates that the CSRF token is associated with the authenticated login context.
- Sign-up/sign-in and CSRF bootstrap are pre-authentication operations: there cannot be a JWT yet. They use the pre-authentication CSRF token as specified by the API contract.
- OAuth start/callback routes are browser redirects, not JSON envelope endpoints; OAuth `state` validation is required.
- The backend has no database. Demo users are in memory and reset on backend restart. Catalog data is fixed mock data. Product writes are acknowledged but not persisted on the server.
- The frontend persists accepted added products and hidden product IDs in `localStorage`. JWT and CSRF tokens are not persisted there.
- All JSON API responses use `{ "code", "message", "data" }`. OAuth redirects/callbacks are the documented exception.
- Catalog is small and fixed; pagination fields are not expected.

## 3. Test data and setup

### Demo accounts

- `learner@example.test` with a known test password, created through sign-up.
- An unregistered email for negative sign-in tests.
- A second account for cross-account token-binding tests.

Use non-production credentials and tokens only. Password storage and verification use Spring Security `BCryptPasswordEncoder`.

### Product examples

Valid product:

```json
{
  "id": "prd_local_test_001",
  "name": "Test Mug",
  "description": "A product created for a test.",
  "price": 9.5,
  "currency": "USD",
  "imageUrl": null
}
```

Boundary/invalid values include empty and overlong names, negative/NaN/infinite prices, missing currency, malformed image URLs, oversized descriptions, duplicate IDs, Unicode text, and HTML/script-like strings.

### Credential fixtures

Prepare valid, expired, malformed, wrong-signature, and revoked JWTs where the implementation supports revocation. Prepare a valid pre-auth CSRF token, valid login-associated CSRF token, expired token, random token, and a token associated with a different JWT/login context.

## 4. Cross-cutting API contract tests

### TC-API-001 — Success envelope shape

For every successful JSON API endpoint, assert HTTP status is appropriate and body contains exactly the required top-level fields `code`, `message`, and `data` (future optional fields require contract updates). Confirm there is no duplicate `success` flag or redundant HTTP status field.

### TC-API-002 — Error envelope shape

For each API error, assert the same envelope shape is returned, `code` agrees with HTTP status, and `data` is an object for validation details or `null` when there are none.

### TC-API-003 — Correct content type

JSON endpoints return `application/json` with UTF-8. OAuth authorization/callback routes use browser redirects and are not forced into JSON envelopes.

### TC-API-004 — No-content responses are avoided

Successful hide/logout operations return a JSON envelope and HTTP 200, not 204 with an empty body.

### TC-API-005 — Stable application codes

Assert clients can distinguish codes without parsing `message`; messages may change while codes remain stable.

### TC-API-006 — Safe error messages

Verify responses do not reveal password hashes, stack traces, signing keys, raw provider errors, tokens, whether an email exists during sign-in, or other secrets.

### TC-API-007 — Unsupported media type

Submit a body with an unsupported content type. Expect 415 with the standard envelope and no side effects.

### TC-API-008 — Malformed JSON

Send truncated JSON, invalid encoding, JSON array where object is required, and scalar JSON. Expect a safe 400 envelope; server remains available.

### TC-API-009 — Unexpected exception

Cause a controlled internal failure in a test environment. Expect generic 500 envelope; no stack trace, token, or secret is returned.

### TC-API-010 — HTTP method mismatch

Call each endpoint with unsupported methods. Expect a consistent 405 response policy and no mutation. If 405 is added to the documented error status table, preserve the envelope.

### TC-API-011 — No pagination contract

Call `GET /api/v1/products`; confirm fixed product list is returned without `page`, `size`, `totalElements`, or pagination links.

## 5. UC-01 — CSRF token bootstrap

Endpoint: `POST /api/v1/csrf-token`.

### Credential requirements by request stage

| Request stage | JWT required? | CSRF header required? | Reason |
|---|---:|---:|---|
| `POST /api/v1/csrf-token` bootstrap | No | No | This first request obtains the pre-auth CSRF token; requiring that token here would create a bootstrap loop. |
| `POST /api/v1/auth/signup` | No | Yes, pre-auth token | Registration happens before an authenticated JWT exists. |
| `POST /api/v1/auth/signin` | No | Yes, pre-auth token | Sign-in creates the JWT, so it cannot require that JWT in the same request. |
| Authenticated `POST`, `PUT`, `PATCH`, `DELETE` (product writes/logout) | Yes | Yes, token associated with the login context | These are the protected state-changing operations covered by the dual-header policy. |
| Protected read-only `GET` | Yes | No | GET is not a state-changing operation under this API contract. |
| OAuth callback | No application JWT yet | OAuth `state`, not app CSRF/JWT | The provider callback is validated using the OAuth flow; the app JWT is issued after successful callback. |

The requirement is therefore: **all authenticated state-changing business endpoints require both JWT and CSRF**. It does not apply literally to the bootstrap endpoint or pre-authentication endpoints. The CSRF bootstrap call shown below without JWT is intentional and is not a test contradiction.

### TC-CSRF-001 — Issue a pre-auth token

Call without JWT. Expect 200 envelope with non-empty `data.token`, `data.headerName == "X-CSRF-TOKEN"`, and valid `expiresAt`.

### TC-CSRF-002 — Token has sufficient unpredictability

Request multiple tokens across independent client contexts. Confirm tokens are not constant, sequential, timestamps, email-derived, or otherwise guessable. Do not print real values in CI logs.

### TC-CSRF-003 — Bootstrap retry behavior

Repeat the request within the documented lifetime. Confirm behavior matches the contract (stable token or intentional rotation) and that prior frontend behavior does not become silently invalid.

### TC-CSRF-004 — Expired pre-auth token

Use an expired token on sign-up/sign-in. Expect 403 `CSRF_INVALID` (or the documented pre-auth CSRF error) and no account/authentication side effect.

### TC-CSRF-005 — Missing pre-auth token on signup

Submit valid signup body without `X-CSRF-TOKEN`. Expect rejection and no account created.

### TC-CSRF-006 — Missing pre-auth token on signin

Submit valid login body without pre-auth CSRF header. Expect rejection and no JWT returned.

### TC-CSRF-007 — Random or tampered pre-auth token

Modify one character or submit an unrelated value. Expect rejection; do not authenticate or create an account.

### TC-CSRF-008 — Wrong header name

Send the token under `X-CSRF-TOKEN-ALT` or in an uncontracted body field. Expect rejection.

### TC-CSRF-009 — Header whitespace and normalization

Test leading/trailing whitespace, empty string, whitespace-only, and duplicate header instances. Reject invalid/ambiguous values consistently.

### TC-CSRF-010 — Token is not put in URL

Inspect API responses, redirects, and generated links. Confirm CSRF token is never included in a query string or URL fragment.

### TC-CSRF-011 — Token is not logged

Inspect application and test logs for raw CSRF values. Confirm they are redacted/absent.

### TC-CSRF-012 — No cookie side effect

Confirm CSRF bootstrap does not create an authentication/session cookie or place token in `Set-Cookie`, consistent with JWT-only design.

## 6. UC-02 — Sign-up

Endpoint: `POST /api/v1/auth/signup`; requires pre-auth `X-CSRF-TOKEN`, no JWT.

### TC-SIGNUP-001 — Valid new account

Submit valid email/password with valid pre-auth CSRF. Expect 201 `CREATED`, safe user summary, no JWT, and no password/hash in response. Account is available for sign-in in the current backend process.

### TC-SIGNUP-002 — Duplicate email exact match

Submit the same email again. Expect 409 `EMAIL_ALREADY_REGISTERED`, stable envelope, no duplicate account.

### TC-SIGNUP-003 — Duplicate email case variation

Register `User@Example.test`, then try a case variation. Confirm canonicalization/uniqueness policy and expected conflict behavior; document if case-sensitive by design.

### TC-SIGNUP-004 — Email whitespace

Test leading/trailing whitespace. Confirm documented trim/reject policy and prevent duplicate identities caused by whitespace.

### TC-SIGNUP-005 — Invalid email boundaries

Test empty, missing `@`, multiple `@`, invalid domain, Unicode address, extremely long address, and leading/trailing spaces. Expect 400 field errors and no account creation when invalid.

### TC-SIGNUP-006 — Password boundary values

Test missing, empty, too short, too long, Unicode, whitespace-only, and password containing special characters. Expect documented validation without echoing the value.

### TC-SIGNUP-007 — Missing/null fields

Test missing email, missing password, explicit `null`, and unexpected JSON types. Expect 400 validation errors.

### TC-SIGNUP-008 — Untrusted extra fields

Submit fields such as `role`, `admin`, `userId`, `provider`, or `passwordHash`. They must be ignored or rejected; caller must not assign privileges or identity IDs.

### TC-SIGNUP-009 — Invalid CSRF with valid body

Use missing, expired, random, wrong-context, or malformed pre-auth token. Expect CSRF rejection and no account created.

### TC-SIGNUP-010 — No JWT required before signup

Submit a valid pre-auth CSRF token without Authorization header. Expect normal signup success; the API must not require a JWT that signup is meant to precede.

### TC-SIGNUP-011 — In-memory persistence boundary

Create account, confirm sign-in works before restart, restart backend, then confirm account is absent as documented. Ensure no unintended persistent file/database is created.

### TC-SIGNUP-012 — Concurrent duplicate registration

Submit simultaneous registrations for the same canonical email. At most one succeeds; others receive conflict, with no duplicate in-memory account.

## 7. UC-03 — Sign-in

Endpoint: `POST /api/v1/auth/signin`; requires pre-auth CSRF, no JWT.

### TC-SIGNIN-001 — Valid credentials

Sign in with an existing account and valid pre-auth CSRF token. Expect 200 `OK`, bearer token, token type `Bearer`, expiry, user summary, and CSRF token associated with the new login context.

### TC-SIGNIN-002 — Unknown email

Use an unregistered email and valid CSRF. Expect generic 401 `INVALID_CREDENTIALS`; response must not confirm whether the email is registered.

### TC-SIGNIN-003 — Wrong password

Use known email and incorrect password. Expect the same public error code/message style as unknown email.

### TC-SIGNIN-004 — Missing/invalid pre-auth CSRF

Try absent, expired, random, malformed, wrong-name, duplicate, and whitespace-only CSRF headers. Expect rejection before credentials produce a JWT.

### TC-SIGNIN-005 — No existing JWT required

Call sign-in without Authorization. Valid credentials plus pre-auth CSRF must succeed; sign-in cannot require the token it creates.

### TC-SIGNIN-006 — Unexpected `mode` field

Send `mode: SESSION`, `mode: JWT`, or other unknown mode. Contract says JWT-only and no mode field; reject or ignore consistently, never create a session-cookie mode.

### TC-SIGNIN-007 — No authentication cookie

Inspect all response headers, including `Set-Cookie`. Confirm sign-in does not issue a session or JWT cookie.

### TC-SIGNIN-008 — Password never echoed

Inspect body and logs. Confirm password and password hash are absent.

### TC-SIGNIN-009 — Token claims and expiry

Validate signature, issuer/audience policy if configured, subject, `jti`, and expiration. Reject not-yet-valid/expired tokens and malformed claims.

### TC-SIGNIN-010 — Repeated sign-in

Sign in repeatedly. Confirm each issued JWT/CSRF pair follows the configured expiry and association policy; token from one login must not accidentally validate as another login's CSRF token if login contexts are distinct.

### TC-SIGNIN-011 — Account store reset

After backend restart, sign in with an account created only in memory. Expect generic invalid credentials.

### TC-SIGNIN-012 — Rate/concurrency edge

Submit parallel sign-in attempts and rapid repeated failures in a local test profile. Ensure no account lock corruption or unhandled exceptions. If rate limiting is added, assert its documented response separately.

## 8. UC-04 / UC-05 — OAuth sign-in

Routes:

- Google: `GET /oauth2/authorization/google`, callback `GET /login/oauth2/code/google`.
- Facebook: `GET /oauth2/authorization/facebook`, callback `GET /login/oauth2/code/facebook`.

Run each scenario for both providers where provider setup permits. Use provider sandbox/test accounts; never commit client secrets.

### TC-OAUTH-001 — Authorization start

Click each provider button. Confirm browser redirects to the correct provider registration and requested scopes are minimal and documented.

### TC-OAUTH-002 — OAuth state generated

Confirm authorization request includes unpredictable `state` and that state is bound to the initiating browser flow per Spring Security configuration.

### TC-OAUTH-003 — Successful provider login

Complete provider authentication and consent. Confirm application identity is mapped/provisioned, provider is recorded, and shop redirect occurs.

### TC-OAUTH-004 — Handoff code exchanged for app credentials

After successful provider callback, verify the backend redirects only with a short-lived application handoff code. Frontend sends it to `POST /api/v1/auth/oauth/exchange` with the pre-auth CSRF header. Expect JSON envelope containing the application JWT and login-associated CSRF token. Provider authorization code, JWT, and CSRF token must not appear in the redirect URL.

### TC-OAUTH-005 — Provider identity shown safely

Confirm shop shows provider name and only allowed profile claims; no provider access token or unnecessary raw claims are exposed.

### TC-OAUTH-006 — Consent denied

Deny consent at Google/Facebook. Confirm user remains unauthenticated, receives safe feedback, and no app JWT is issued.

### TC-OAUTH-007 — State missing

Remove `state` from callback. Reject callback; no account/JWT.

### TC-OAUTH-008 — State tampered

Change callback state. Reject and record safe security event; no account/JWT.

### TC-OAUTH-009 — State replay

Replay a previously successful callback/state. Reject if the state is one-time; confirm no duplicate login/account side effect.

### TC-OAUTH-010 — Callback from another browser/context

Start flow in browser context A and replay callback in context B. Reject state/context mismatch.

### TC-OAUTH-011 — Invalid authorization code

Use expired, already-used, malformed, or wrong-client authorization code. Fail safely with no token leak.

### TC-OAUTH-012 — Provider unavailable/timeout

Simulate DNS/connectivity timeout, provider 5xx, or token endpoint timeout. Show recoverable error, remain signed out, and avoid duplicate account creation.

### TC-OAUTH-013 — Invalid/missing client configuration

Run without client ID/secret or with wrong credentials. Startup or login failure must be clear and must not expose secrets.

### TC-OAUTH-014 — Email claim absent/unverified

Provider returns no email or an unverified email. Apply documented linking policy; do not link to an existing local account solely on an unverified claim.

### TC-OAUTH-015 — Provider account already linked

Repeat OAuth login with same provider subject. Reuse the same local identity; do not create duplicates.

### TC-OAUTH-016 — Same email from different providers

Log in with matching email from Google and Facebook. Confirm account linking follows explicit policy and does not silently merge identities based only on email.

### TC-OAUTH-017 — OAuth callback is not JSON envelope

Confirm callback behavior is redirect-based as contracted, while any API error/status endpoint still uses the standard JSON envelope.

### TC-OAUTH-018 — Provider token separation

Attempt to use Google/Facebook provider access token as `Authorization: Bearer` for app endpoints. Reject unless explicitly supported (not in this contract).

### TC-OAUTH-019 — Handoff code is single-use

Redeem the code once successfully, then replay it. The replay must fail and must not issue a second JWT/CSRF pair.

### TC-OAUTH-020 — Handoff code expiration and tampering

Test expired, random, truncated, altered, malformed, wrong-provider, and wrong-transaction codes. Fail safely without issuing credentials.

### TC-OAUTH-021 — Exchange requires pre-auth CSRF

Call exchange with a valid handoff code but absent, expired, random, or wrong-context pre-auth CSRF. Expect 403 and ensure code-consumption behavior is deliberate: invalid-CSRF attempts must not let an attacker consume another browser's valid code.

### TC-OAUTH-022 — Popup message origin validation

For popup mode, confirm callback page posts only to the exact configured frontend origin. Reject messages from unexpected origins and ensure the opener validates `event.origin`, `event.source`, provider transaction, and expected message shape before exchanging the code.

### TC-OAUTH-023 — Handoff code URL hygiene

Confirm callback page uses no-store/no-referrer policy, loads no third-party assets, removes the code from browser history promptly, and never logs or analytics-captures it.

### TC-OAUTH-024 — Same-tab callback

If same-tab mode is selected, frontend consumes the handoff code once, exchanges it, then replaces the callback URL so refresh/back navigation cannot redeem or expose it again.

### TC-OAUTH-025 — Exchange outage and retry

If network fails before code redemption, allow the documented retry behavior while code is still valid. If backend consumes code but response is lost, fail safely and require restarting OAuth rather than issuing duplicate credentials.

## 9. UC-06 — Homepage and fixed catalog

Endpoints: `GET /api/v1/homepage`, `GET /api/v1/products`; JWT required.

### TC-SHOP-001 — Authenticated homepage

Call with valid JWT. Expect 200 envelope, safe user summary, shop name, and no secrets.

### TC-SHOP-002 — Unauthenticated homepage

Call without Authorization. Expect 401 envelope.

### TC-SHOP-003 — Invalid JWT homepage

Use malformed, expired, wrong-signature, wrong-audience, or unsupported token. Expect 401 envelope with no claims leaked.

### TC-SHOP-004 — Fixed catalog response

Call products endpoint with valid JWT. Expect same canonical mock catalog, valid product shape, no pagination metadata, no DB dependency.

### TC-SHOP-005 — Catalog stable across backend restart

Restart backend and fetch catalog. Fixed mock catalog remains available and unchanged.

### TC-SHOP-006 — Concurrent reads

Send parallel homepage/catalog requests. Responses remain valid, independent, and enveloped.

### TC-SHOP-007 — Product list does not mutate state

Repeat GET and confirm no localStorage changes or product side effects occur.

### TC-SHOP-008 — Missing/invalid client storage

Test absent storage, malformed JSON, wrong schema, null values, huge arrays, duplicate local IDs, and quota errors. UI recovers to server mock catalog, handles errors, and does not crash.

### TC-SHOP-009 — XSS-like mock data

Render product fields containing HTML/script strings. Ensure UI escapes text and does not execute injected markup.

## 10. UC-07 — Add product

Endpoint: `POST /api/v1/products`; requires valid JWT plus login-associated CSRF header.

### TC-ADD-001 — Valid product

Send valid JWT, matching CSRF token, and valid product. Expect 201 envelope with product acknowledgement. Only after success is the product stored in localStorage and rendered.

### TC-ADD-002 — Missing Authorization

Send valid CSRF and body but no JWT. Expect 401 and no localStorage update.

### TC-ADD-003 — Missing CSRF header

Send valid JWT and body without CSRF. Expect 403 `CSRF_INVALID`; no localStorage update.

### TC-ADD-004 — Invalid/expired JWT

Send invalid JWT with otherwise valid CSRF/body. Expect 401, not successful acknowledgement.

### TC-ADD-005 — Invalid/expired CSRF

Send valid JWT with random, malformed, expired, revoked, or tampered CSRF token. Expect 403 `CSRF_INVALID`.

### TC-ADD-006 — CSRF token belongs to another JWT/login

Use account A JWT with account B/login CSRF token. Expect rejection.

### TC-ADD-007 — Credential pair from different logins

Use JWT from one sign-in and CSRF token from another sign-in of the same user. Assert configured binding policy; if tokens are bound to `jti`, reject mismatch.

### TC-ADD-008 — Authorization scheme errors

Test `Basic`, lowercase/incorrect scheme if case-sensitive by contract, `Bearer` with missing token, two bearer values, surrounding whitespace, and duplicate Authorization headers. Reject consistently.

### TC-ADD-009 — Both JWT and a stray cookie

Send valid headers plus an unrelated cookie. Confirm server does not authenticate from cookies and does not create/require a session.

### TC-ADD-010 — Empty/missing product name

Expect 400 field error; no local persistence.

### TC-ADD-011 — Name length boundaries

Test 1, 100, and 101 characters plus very large body. Accept/reject per contract and enforce request-size limits safely.

### TC-ADD-012 — Description boundaries

Test absent, null, empty, 500, 501 chars, Unicode, emoji, and HTML/script. Apply limits and render safely.

### TC-ADD-013 — Price boundaries

Test zero, positive decimal, negative, missing, null, string, `NaN`, `Infinity`, too many decimal places, and very large magnitude. Accept only finite non-negative values under the agreed precision policy.

### TC-ADD-014 — Currency validation

Test valid uppercase 3-letter code, lowercase, wrong length, numeric, missing, and null. Enforce contract.

### TC-ADD-015 — Image URL validation

Test null, valid HTTPS URL, relative path, malformed URL, `javascript:` scheme, extremely long URL, and disallowed protocols. Reject unsafe values or use placeholder.

### TC-ADD-016 — Client ID validation

Test missing, empty, duplicate, malformed, extremely long, and injection-like IDs. Reject collisions/invalid IDs; do not trust IDs as authorization.

### TC-ADD-017 — Unexpected fields

Submit fields such as `ownerId`, `isAdmin`, server status, or hidden flag. Ignore/reject; never let client modify identity/privilege or bypass flow.

### TC-ADD-018 — Cross-user product submission

Attempt to set product owner to another user. There is no server-owned product state; reject/ignore uncontracted ownership fields.

### TC-ADD-019 — Backend accepts but localStorage write fails

Simulate quota exceeded, private mode/security exception, or disabled storage after a successful response. Show a persistence warning and accurately explain backend did not save it; avoid claiming durable success.

### TC-ADD-020 — Network failure before response

Drop connection. Do not update localStorage before confirmation; show retry option without creating duplicate local products.

### TC-ADD-021 — Timeout after backend accepted

Simulate response lost after backend acknowledgement. Since backend is non-persistent, retry must not create duplicate local entries; use stable client product ID/idempotent handling.

### TC-ADD-022 — Rapid double-submit

Double-click submit or press Enter repeatedly. Prevent duplicate UI/localStorage entries or handle same client ID idempotently.

### TC-ADD-023 — Header values are never logged

Verify backend logs redact Authorization and CSRF values for valid and rejected requests.

## 11. UC-08 — Hide product

Endpoint: `DELETE /api/v1/products/{productId}`; requires valid JWT plus associated CSRF header.

### TC-HIDE-001 — Hide fixed catalog product

Send valid headers for a seeded product ID. Expect 200 envelope with `hidden: true`; frontend saves ID in hidden collection and filters it out.

### TC-HIDE-002 — Hide locally added product

Add product, then hide it. Confirm it disappears and the ID appears only once in hidden storage.

### TC-HIDE-003 — Missing JWT / invalid JWT

Expect 401; local hidden-ID list remains unchanged.

### TC-HIDE-004 — Missing CSRF / invalid CSRF

Expect 403 `CSRF_INVALID`; local hidden-ID list remains unchanged.

### TC-HIDE-005 — CSRF bound to another login

Use a token associated with another JWT. Expect 403.

### TC-HIDE-006 — Malformed product ID path

Test empty path, encoded slash, invalid characters, overlong segment, traversal-like strings, and percent-encoding variants. Reject safely; no local mutation.

### TC-HIDE-007 — Unknown product ID

Use unknown syntactically valid ID. Follow contract: backend can acknowledge because it does not own catalog membership; UI only hides matching local product if present. Do not imply server deletion.

### TC-HIDE-008 — Repeated hide (idempotency)

Repeat DELETE for same ID. The UI remains hidden and storage contains one ID; response behavior follows documented idempotent semantics.

### TC-HIDE-009 — Hide then reload

Reload shop. Product remains hidden because hidden ID is stored locally.

### TC-HIDE-010 — Hide then clear browser storage

Clear localStorage and reload. Seed product returns; this is expected because hide was browser-local.

### TC-HIDE-011 — localStorage failure after success

Simulate storage write failure. Show error/refresh recovery accurately; backend did not persist deletion.

### TC-HIDE-012 — Network failure/timeout

Ensure the frontend does not hide until successful acknowledgement. On ambiguous timeout, avoid duplicate state or explain retry outcome.

### TC-HIDE-013 — Concurrent hide requests

Issue simultaneous DELETE requests for same ID. UI/storage converges to one hidden ID; no crash.

### TC-HIDE-014 — Cross-account browser state

Sign out and sign in as a different user in the same browser. Product storage is browser-local and may be visible to the next user. Test this behavior and document/reset storage on sign-out if product privacy is expected. Do not confuse local product state with account ownership.

## 12. UC-09 — Combined JWT + CSRF request inspection

### TC-COMBO-001 — Both headers present and valid

For each authenticated state-changing route, send valid JWT and associated CSRF token. Expect operation success and correct envelope.

### TC-COMBO-002 — JWT only

Omit CSRF header. Expect 403 `CSRF_INVALID` on state-changing authenticated route.

### TC-COMBO-003 — CSRF only

Omit JWT. Expect 401; do not reveal whether CSRF was valid.

### TC-COMBO-004 — Both absent

Expect 401 or the documented authentication-first response, consistently. No mutation.

### TC-COMBO-005 — Wrong pair

Mix JWT and CSRF token from different users/login contexts. Reject.

### TC-COMBO-006 — Read-only GET behavior

Call homepage, products, and auth-context GET with valid JWT but no CSRF header. Expect success; GET responses do not require CSRF per contract.

### TC-COMBO-007 — Header inspection UI

Confirm request preview shows both header names and masks token values by default. If reveal is supported, it is local-only, opt-in, and never copied to logs.

### TC-COMBO-008 — Method tampering

Change a protected POST to GET or an unprotected method. Confirm server does not perform a state change through safe methods; unknown methods are rejected.

### TC-COMBO-009 — CORS/preflight

From a disallowed origin, attempt requests with Authorization and X-CSRF-TOKEN. Reject disallowed origin; do not reflect arbitrary origins or allow credentials unnecessarily. For approved frontend origin, preflight only allows required methods/headers.

### TC-COMBO-010 — Content-type downgrade

Attempt form-encoded or `text/plain` request to a JSON mutation endpoint. Reject unsupported content types and do not mutate local/backend state.

## 13. UC-10 — Logout

Endpoint: `DELETE /api/v1/auth/sessions`; requires JWT + CSRF header.

### TC-LOGOUT-001 — Valid logout

Send valid JWT and associated CSRF token. Expect 200 envelope with `data: null`; frontend clears JWT and CSRF state from memory and navigates to sign-in. Product localStorage remains.

### TC-LOGOUT-002 — Missing/invalid JWT

Expect 401 and no false success message.

### TC-LOGOUT-003 — Missing/invalid/mismatched CSRF

Expect 403 `CSRF_INVALID`; client must not claim successful logout if backend rejects.

### TC-LOGOUT-004 — Repeat logout

Repeat after client has cleared credentials. UI returns to signed-out state gracefully; API returns documented unauthenticated response or idempotent response consistently.

### TC-LOGOUT-005 — Old JWT after logout

Attempt protected calls with copied pre-logout JWT. Because stateless JWT may remain valid until expiry without revocation, verify actual configured policy and ensure UI/docs do not claim revocation if none exists.

### TC-LOGOUT-006 — Clear credentials but preserve shop state

Confirm JWT and CSRF are removed from memory, while local product additions/hidden IDs persist per use-case contract.

### TC-LOGOUT-007 — Browser refresh after logout

Refresh and confirm protected UI does not reappear without a valid in-memory JWT; unauthenticated state is shown.

## 14. Frontend token lifecycle and security edge cases

### TC-CLIENT-001 — JWT not persisted

Inspect localStorage, sessionStorage, IndexedDB, cookies, URLs, and logs after sign-in. JWT appears only in memory and intended transient network header.

### TC-CLIENT-002 — CSRF token not persisted

Confirm CSRF token is not in localStorage/sessionStorage/cookie/URL. It remains in memory only.

### TC-CLIENT-003 — Reload behavior

Reload the page. In-memory JWT/CSRF are gone; user must sign in again unless a refresh-token flow is later specified. Product local state remains.

### TC-CLIENT-004 — Sign-out cleanup

Clear token references from application state and request interceptors. Subsequent requests must not send stale Authorization or CSRF headers.

### TC-CLIENT-005 — Cross-origin header leakage

Ensure frontend only attaches JWT/CSRF to the configured API origin; never leak them to images, analytics, provider domains, or arbitrary URLs.

### TC-CLIENT-006 — Multiple tabs

Open two tabs, sign in/out or sign in as different accounts. In-memory tokens are tab-local; ensure no accidental cross-tab token leak. localStorage product state is shared and should be handled as browser-local shared data.

### TC-CLIENT-007 — XSS handling

Render user/product text safely. Note that any active XSS could read in-memory JWT/CSRF; ensure UI never renders untrusted HTML and document token exposure as a learning boundary.

### TC-CLIENT-008 — Clock skew/expiry boundary

Test JWT/CSRF just before expiration, at expiration, and after expiration with small clock skew. Frontend handles 401/403 and clears/re-authenticates without infinite retry loops.

### TC-CLIENT-009 — Concurrent API requests

Send parallel requests near expiry. Ensure no request mixes token pairs from different login contexts and failures do not corrupt UI state.

### TC-CLIENT-010 — Response caching

Ensure token-bearing responses use appropriate no-store cache headers where needed; a shared cache must not serve one user's JWT/CSRF response to another user.

## 15. OAuth and account lifecycle edge cases

### TC-ACCOUNT-001 — Backend restart invalidates demo accounts

Previously signed-up in-memory user is absent after restart. Sign-in returns generic invalid credentials; no stale credential data is exposed.

### TC-ACCOUNT-002 — OAuth user after restart

Confirm whether OAuth-linked account mapping is also in-memory or provider-derived. Test according to documented implementation; this persistence behavior must be explicitly decided before release.

### TC-ACCOUNT-003 — OAuth JWT/CSRF pair lifecycle

After OAuth callback, exchange the single-use handoff code and verify the frontend receives an app JWT and matching CSRF token; both expire/clear according to the login lifecycle.

### TC-ACCOUNT-004 — Provider account unlink/revocation

Provider revokes app consent or account access. Next OAuth attempt follows a safe re-consent/error path and does not reuse a provider token as an app token.

### TC-ACCOUNT-005 — OAuth callback replay after logout

Replay an old callback after logout. Reject stale state/code and do not silently restore a logged-in UI.

## 16. Acceptance checklist

The release candidate is acceptable when:

- Every documented UC has at least one successful and relevant negative test.
- Every JSON API response, including errors, follows the envelope and correct HTTP status.
- Sign-up/sign-in use pre-auth CSRF but do not require JWT.
- Authenticated state-changing endpoints require both JWT and login-associated CSRF token.
- Read-only GET endpoints require JWT but not CSRF header.
- OAuth `state` is validated and the one-time handoff-code exchange is covered; popup/same-tab UI mode is selected.
- Product add/hide update localStorage only after backend acknowledgement and never claim server persistence.
- Backend restart behavior for in-memory users and fixed catalog matches documentation.
- JWT and CSRF values are not persisted to browser storage, cookies, URLs, or logs.
- No pagination metadata is returned for the fixed catalog.
- All unresolved contract decisions are closed or explicitly documented before their dependent tests are marked complete.

## 17. Open contract decisions affecting tests

1. Popup versus same-tab frontend presentation for the already-defined handoff-code exchange.
2. Whether OAuth/CSRF ephemeral state stays in memory for the local single-instance app or uses Redis; if Redis is selected, define outage behavior, key TTLs, atomic consume operation, and deployment secrets.
3. Exact JWT signing algorithm, issuer/audience, expiry, and `jti` policy.
4. Exact association strategy and lifetime/revocation behavior for CSRF tokens.
5. Whether pre-auth CSRF tokens are single-use and what error code represents expiry/replay.
6. Canonical email normalization and password length/complexity rules.
7. Product ID format, decimal precision, and malformed/unknown ID behavior.
8. Whether rate limiting is in scope for sign-in and token bootstrap.
9. Whether logout revokes JWT server-side or only clears client-held state.

## 18. Adversarial review — additional bypass and edge-case scenarios

These cases extend the baseline use-case tests by treating the API as if a hostile client can alter every request, replay every value it sees, race requests, and submit malformed or oversized input. Run only against the local/test application.

### 18.1 Pre-auth CSRF bootstrap and login abuse

#### TC-RED-CSRF-001 — Bootstrap endpoint flooding

Issue a high volume of `POST /api/v1/csrf-token` requests from one client and across many synthetic clients. Confirm bounded memory/CPU usage, no unbounded token registry growth, and a documented throttling response if rate limiting is implemented.

#### TC-RED-CSRF-002 — Pre-auth token context isolation

Obtain token A in client context A and token B in context B. Try using A from B on sign-up/sign-in. Reject cross-context use if the design binds pre-auth tokens to a client context; otherwise document the intended threat model and rely on an explicitly designed stateless token validation scheme.

#### TC-RED-CSRF-003 — Pre-auth token replay/use-after-consumption

Replay the same pre-auth token after successful sign-up/sign-in, after expiration, and after a failed attempt. Verify the chosen policy (single-use or bounded reuse) and ensure an old token cannot mint unlimited login attempts contrary to policy.

#### TC-RED-CSRF-004 — Login CSRF/account swapping

Attempt to force a victim browser into an attacker-controlled account using a cross-site login submission. Verify the pre-auth token is unpredictable, inaccessible cross-origin, validated, and associated with the initiating client flow.

#### TC-RED-CSRF-005 — CORS misconfiguration exposes pre-auth token

From an untrusted origin, request the CSRF bootstrap with credential/header variations. Confirm the server does not reflect arbitrary `Origin`, does not allow wildcard origins together with credentials, and does not expose token response to hostile origins.

#### TC-RED-CSRF-006 — Token registry growth and cleanup

Create many pre-auth tokens, wait past expiry, and verify expired entries are removed or bounded. Verify expiry cleanup does not remove live tokens or make concurrent requests fail unexpectedly.

#### TC-RED-CSRF-007 — Redis-backed state TTL and atomic consumption (if Redis is used)

Verify CSRF/handoff records receive the configured TTL, expire automatically, and do not survive beyond JWT/code lifetime. Redeem the same handoff code concurrently from two workers; at most one request succeeds. Store only the intended opaque value/hash and association data, never JWT signing keys.

#### TC-RED-CSRF-008 — Redis unavailable or evicted state (if Redis is used)

Simulate Redis timeout, restart, eviction, and connection failure during token issue/validation/redemption. Fail closed for protected mutations and OAuth code exchange; return a safe envelope without issuing credentials or accepting an unvalidated request. Confirm recovery does not resurrect expired/replayed state.

### 18.2 JWT parsing, validation, and identity confusion

#### TC-RED-JWT-001 — Unsigned/`none` algorithm token

Submit a token with no valid signature or an unsupported `alg` such as `none`. Expect 401; the server must allow only explicitly configured algorithms.

#### TC-RED-JWT-002 — Algorithm/key confusion

Try a token signed with a different algorithm or wrong key type. Expect 401; algorithm must not be selected solely from untrusted token headers.

#### TC-RED-JWT-003 — Claim validation

Test missing/invalid `sub`, `exp`, `iat`, `iss`, `aud`, and `jti`; future `iat`; expired `exp`; and impossible claim types. Reject malformed or policy-violating credentials.

#### TC-RED-JWT-004 — Token substitution across environments

Use development token against another environment/issuer/audience. Reject if issuer/audience/environment binding is configured; never accept a token solely because its signature verifies under a shared key.

#### TC-RED-JWT-005 — Duplicate/ambiguous Authorization headers

Send repeated Authorization headers, comma-combined values, multiple bearer tokens, or proxy-normalized duplicates. Reject ambiguity consistently; do not pick a weaker/attacker-controlled value.

#### TC-RED-JWT-006 — Oversized token/header

Submit a very large JWT and very large Authorization header. Reject with bounded resource use and safe response; avoid excessive logging or parser allocation.

#### TC-RED-JWT-007 — JWT header injection fields

Include untrusted `jku`, `x5u`, `kid` path traversal, remote key URLs, embedded `jwk`, or control characters. Server must not fetch attacker-provided key URLs or interpret key IDs as paths; reject unknown key IDs.

#### TC-RED-JWT-008 — Subject/role tampering

Change `sub`, email, provider, or role claims and re-sign with an invalid key. Reject. Ignore client-supplied identity/role fields in product request bodies.

#### TC-RED-JWT-009 — Expiry race and clock skew

Test at exact expiry boundaries and with backend clock skew. Expired tokens must fail consistently; allowed skew must be small and explicit.

#### TC-RED-JWT-010 — Revocation and stale CSRF pairing

After logout or token expiry, attempt a mutation with old JWT and matching old CSRF token. Enforce the documented revocation policy. If logout only clears client memory, confirm the server does not claim the JWT was revoked.

### 18.3 CSRF-to-JWT association and mutation bypass

#### TC-RED-PAIR-001 — Cross-user and cross-login token pairing

Pair JWT A with CSRF B for another user, another login, and another provider. Every mismatch must fail before product/local UI state changes.

#### TC-RED-PAIR-002 — Token from another token lifecycle stage

Use pre-auth CSRF on an authenticated mutation, and authenticated CSRF on sign-up/sign-in. Enforce the separation defined by the API contract.

#### TC-RED-PAIR-003 — CSRF token substitution/truncation/encoding

Test one-byte change, URL/base64 encoding changes, Unicode normalization, null byte, CR/LF, tabs, and truncation. Reject invalid tokens and prevent header injection.

#### TC-RED-PAIR-004 — Token replay on distinct mutations

Reuse one valid CSRF token across several product mutations, including after logout, expiry, or re-login. Match the defined policy: if tokens are per-login, they may be reused only within that login lifetime; if one-time, a replay must fail. Do not accidentally mix policies.

#### TC-RED-PAIR-005 — Method override bypass

Try `_method=DELETE`, `X-HTTP-Method-Override`, query-string method overrides, lowercase methods, and alternate content types to bypass the CSRF guard. Ensure effective method is validated consistently and state changes cannot occur through a path that skips the dual-header filter.

#### TC-RED-PAIR-006 — Route/path normalization bypass

Test trailing slash, duplicate slash, encoded slash, dot segments, mixed case, semicolon path parameters, path parameters, and reverse-proxy normalization. Every route alias that reaches a mutation handler must enforce both headers.

#### TC-RED-PAIR-007 — Filter-chain ordering

Send invalid JWT plus invalid CSRF, valid JWT plus invalid CSRF, and malformed Authorization with missing CSRF. Confirm failures are deterministic, no controller executes, and error precedence does not disclose token validity unnecessarily.

#### TC-RED-PAIR-008 — No mutation before all checks pass

Inject failures after JWT parse, after CSRF verification, during product validation, and before response. Confirm no client localStorage update occurs unless a successful envelope is received; because backend has no product persistence, error handling must not invent server state.

#### TC-RED-PAIR-009 — All unsafe verbs covered

For every registered `POST`, `PUT`, `PATCH`, and `DELETE` route, including logout and future endpoints, verify security configuration requires the expected JWT/CSRF pair except the explicitly documented pre-authentication endpoints. Add a route-inventory test so a newly added mutation cannot silently omit the filter.

#### TC-RED-PAIR-010 — Safe methods do not mutate

Call GET/HEAD/OPTIONS variants with query/body parameters that resemble add/hide commands. Confirm they never change state. Disable TRACE and reject unsupported methods.

### 18.5 OAuth protocol and no-session-cookie compatibility

#### TC-RED-OAUTH-001 — Spring OAuth default state storage versus no-session policy

The current project says it uses no session cookies, but Spring Security's default `AuthorizationRequestRepository` stores the OAuth authorization request in `HttpSession`. Verify actual `Set-Cookie` and callback behavior. If a transient session cookie appears, either explicitly allow/document that OAuth-only transient cookie or configure a secure custom state repository; do not claim that absolutely no session cookie exists without checking. Spring Security documents this default behavior in its [authorization grant reference](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html).

#### TC-RED-OAUTH-002 — OAuth state binding and replay

Test missing, tampered, expired, replayed, cross-browser, and cross-provider `state`. Reject and consume state once. Ensure Google state cannot be replayed on Facebook callback or vice versa.

#### TC-RED-OAUTH-003 — PKCE and OIDC nonce policy

Confirm the exact flow's CSRF protections: state is securely bound to the initiating browser, and where OIDC nonce/PKCE is used, verify it on callback/token validation. Reject missing/mismatched values.

#### TC-RED-OAUTH-004 — Authorization code leakage

Ensure OAuth code, state, provider token, app JWT, and CSRF token are not written to logs, analytics, referrer-bearing links, or persistent browser history beyond unavoidable callback URL handling. Remove sensitive callback query parameters promptly after processing.

#### TC-RED-OAUTH-005 — Open redirect / return URL injection

Supply malicious `redirect`, `returnUrl`, encoded external URLs, protocol-relative URLs, and host-header manipulations. After OAuth success/failure, redirect only to an allowlisted local destination.

#### TC-RED-OAUTH-006 — Provider mix-up

Send a Google response to Facebook callback and vice versa; vary issuer, audience, client ID, and token endpoint responses. Reject provider mismatch and validate issuer/registration identity.

#### TC-RED-OAUTH-007 — JWT/CSRF delivery channel

Assert JWT and CSRF never appear in query parameters or URL fragments. The callback may carry only the one-time handoff code; verify its expiry, one-time use, URL cleanup, and exchange behavior.

#### TC-RED-OAUTH-008 — Concurrent OAuth attempts

Start two provider flows in parallel in the same browser, complete them in reverse order, and confirm each callback is matched to its own state/provider without overwriting another flow's token context.

#### TC-RED-OAUTH-009 — Provider profile attack strings

Return very long, malformed, Unicode-confusable, HTML/script-like, or unexpected profile claims. Validate expected types/lengths, render escaped text, and avoid using display name/email as the stable provider identity key.

#### TC-RED-OAUTH-010 — OAuth email collision/account linking

Test verified/unverified/missing email, same email across providers, and email changed at provider. Link by stable provider subject and explicit policy; never auto-merge solely by unverified email.

#### TC-RED-OAUTH-011 — Provider timeout at each stage

Simulate failures during authorization redirect, code exchange, user-info/ID-token retrieval, and app token creation. User stays signed out; no partial account/token state remains.

### 18.7 Envelope, transport, and browser boundary attacks

#### TC-RED-HTTP-001 — Authentication filter error envelope

Trigger failures before controller execution (JWT parser, CSRF filter, OAuth failure, access denied). Confirm Spring Security filter-chain errors still use the agreed envelope; controller advice alone may not cover filter responses.

#### TC-RED-HTTP-002 — Cache isolation

Check `Cache-Control` on sign-in, CSRF-token, user-context, and protected responses. Ensure private/token-bearing responses cannot be cached/shared between users.

#### TC-RED-HTTP-003 — Clickjacking/security headers

Verify appropriate frame restrictions, content-type sniffing protection, referrer policy, and CSP for the shop UI; check that the request inspector's token reveal does not weaken policy.

#### TC-RED-HTTP-004 — HTTPS and proxy headers

In deployment-like test configuration, verify HTTPS is enforced and untrusted forwarded headers cannot spoof host/protocol/redirect URLs. Local development may document HTTP as a local-only exception.

#### TC-RED-HTTP-005 — Request smuggling/header normalization

Through the actual reverse proxy/runtime path, test duplicate Content-Length/Transfer-Encoding and malformed header cases where the test environment supports it. Reject or normalize consistently; do not let proxy and app disagree about request boundaries.

#### TC-RED-HTTP-006 — Unicode and normalization attacks

Test confusable characters in email, product IDs, provider names, and paths. Normalize identifiers consistently or reject unsupported forms; never let visually similar identities collapse unpredictably.

#### TC-RED-HTTP-007 — Error precedence and information leak

For requests with multiple faults (bad JSON + missing JWT, invalid JWT + bad CSRF, nonexistent account + wrong password), verify generic and stable public errors that do not reveal account/token validity unnecessarily.

## 19. Security review findings and contract gaps

The test plan now captures these important issues for implementation review:

1. **CSRF bootstrap is intentionally unauthenticated.** It needs rate/resource controls and a clear pre-auth token lifecycle; no endpoint can require the first token it is responsible for issuing.
2. **All state-changing endpoints need route-wide enforcement.** A newly added POST/PUT/PATCH/DELETE must not bypass the dual-header validator through a new path, method override, or filter-chain ordering issue.
3. **JWT/CSRF binding must be real.** The server must associate CSRF with the JWT/login context and expiration; merely checking for two non-empty headers is not sufficient.
4. **Logout does not necessarily revoke JWT.** With stateless JWT, old tokens may remain valid until expiry unless revocation is explicitly implemented.
5. **OAuth may create a transient HTTP session.** Spring Security's default authorization-request repository stores state in `HttpSession`; this may conflict with a broad “no session cookie” requirement. Decide whether OAuth-only transient session state is allowed or configure a secure alternative.
6. **OAuth uses a one-time handoff code.** JWT/CSRF must never appear in redirect URLs; test code expiry, one-time consumption, callback URL cleanup, and exact-origin popup messaging.
7. **Filter-generated errors may escape the envelope.** Verify security filters and OAuth handlers, not just controller methods, use the common API response contract where applicable.

Several behaviors remain intentionally undecided in the API contract. Tests that depend on them must remain pending until the contract is completed; do not silently treat an assumption as passing behavior.
