# UI Layout and State Specification

## Direction

- Audience: learners aged roughly 17–26.
- Visual baseline: light canvas, blue primary actions, muted informational surfaces, and green success cues. Preserve the existing approved visual identity and prototype patterns while improving clarity and responsive reading order.
- Tone: supportive and direct. Teach security concepts in short explanations near the relevant action.
- Accessibility: semantic headings and forms, visible focus, keyboard-reachable controls, clear labels, live announcements for async results, and sufficient contrast.

## Route `/` — Authentication

### Desktop (1280px)

- Header: product mark/name and a small “Next.js frontend” label.
- Main: two-column welcome and auth card. Welcome side explains the learning goal and steps; auth side contains sign-in/sign-up tabs, fields, inline feedback, submit, provider buttons, and a separate demo entry.
- Keep educational copy secondary to the form so the primary action remains obvious.

### Tablet (768px) and mobile (360px)

- Stack welcome content above the auth card. Keep the form full-width within a comfortable page gutter.
- Keep provider buttons side by side only when their labels remain readable; otherwise stack. Avoid horizontal page overflow.

### States

- Initial/restoring session: show a non-blocking progress message while checking the browser refresh session; do not flash a false “signed out” error.
- Sign-in/sign-up submitting: disable duplicate submission and communicate the current action.
- Validation/API failure: retain the email, clear the password after submission, and associate a readable error with the form. Never display raw provider/server details.
- OAuth handoff: show progress while exchanging the one-time code; show a recoverable message if canceled or rejected.
- Demo: label the mode as simulated before entering it.

## Route `/` — Shop workspace

### Desktop (1280px)

- Workspace heading: shop name and session context, with logout aligned at the end.
- Main area: catalog as the primary column; Request Inspector and JWT learning panel as a secondary column.
- Product cards show name, description, price, source (API/local/demo), and a hide action. Product-add dialog is modal and constrained to viewport.

### Tablet and mobile

- Stack catalog before inspector; keep session/logout controls reachable and clearly separated.
- Catalog cards become one column on narrow screens. Modal uses near-full viewport width with scrollable content if needed.

### States

- Shop loading: skeleton or concise progress state while homepage and catalog load.
- Catalog empty: explain that no products are currently visible and offer the documented add action.
- Catalog/API failure: retain a retry path and do not present stale/local content as server-confirmed.
- Add pending: disable submit and prevent repeated POST; on failure retain entered fields and show inline error.
- Hide pending: disable only the selected product action; on failure keep the card visible.
- Logout pending: disable repeat action. On success clear in-memory auth state and return to auth. On failure preserve the visible session and offer retry so the UI does not claim a revocation that was not confirmed.
- Request Inspector: show only method, route, status, and safe summary. Never expose credentials, tokens, CSRF values, or OAuth handoff codes. Clearly mark simulated rows.

## Responsive and interaction checks

Review at 360px, 768px, and 1280px for overflow, text wrapping, focus visibility, readable contrast, modal reachability, and touch target spacing. Check keyboard traversal through auth, OAuth/demo actions, product dialog, inspector, and logout.
