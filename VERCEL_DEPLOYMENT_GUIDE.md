# Waymate — Vercel + MongoDB Atlas + Brevo

This package is configured so the React/Vite frontend and Express API deploy from one Vercel project. MongoDB Atlas stores accounts and the shared application state; Brevo's transactional email API sends verification codes.

## Before deployment

1. In MongoDB Atlas, use your existing cluster. Create/use database `waymate`, and use a database user with the minimum permissions needed for that database (avoid `atlasAdmin` for production). Since the connection password appeared in a screenshot earlier, rotate that password now and use the new password only in Vercel settings. URL-encode special characters in the URI password.
2. In Brevo, keep your sender verified. The `EMAIL_FROM` address below must exactly match a verified sender in Brevo. A Gmail sender may work for initial testing, but a domain you own with authenticated SPF/DKIM is recommended for production deliverability.
3. In Vercel, import the project/repository and set **Root Directory** to the folder containing this `package.json` (the project root).

## Vercel build settings

- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

## Vercel Environment Variables

Add these for Production (and Preview only if you want preview deployments connected to the same database):

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `/api` |
| `MONGODB_URI` | Full Atlas URI ending in `/waymate?retryWrites=true&w=majority` |
| `JWT_SECRET` | Random secret, at least 32 characters; do not reuse your MongoDB password |
| `BREVO_API_KEY` | The Brevo API key named `Waymate Production`; never expose it in frontend code |
| `EMAIL_FROM` | Exact verified sender email shown in Brevo |
| `EMAIL_FROM_NAME` | `Waymate` |
| `CLIENT_ORIGIN` | Exact Vercel site origin, e.g. `https://your-project.vercel.app` (no trailing slash). If you use a custom domain, include it comma-separated. |
| `NODE_ENV` | `production` |

Generate a JWT secret locally with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, then paste the result directly into Vercel. Do not send secrets in chat or commit them to GitHub.

After adding variables, redeploy so the frontend build sees `VITE_API_BASE_URL=/api`.

## Post-deployment checks

1. Open `https://YOUR-VERCEL-DOMAIN/api/health`. Expect JSON with `ok: true` and `database: "connected"`.
2. Open `https://YOUR-VERCEL-DOMAIN/api/app/public`. It should return the public bootstrap JSON.
3. Sign up with a new test email, username, and registration number. Check that the verification email arrives.
4. Enter the code within 10 minutes, then log in. Unverified accounts are rejected at login.
5. Create a test ride/booking, refresh, and confirm it persists.
6. If emails fail, check Vercel Function Logs and Brevo transactional logs. Common causes are a wrong API key, an unverified sender, an inactive Brevo account, or a sender mismatch.

## Important boundaries

- The API key is server-only. Do not prefix it with `VITE_` and do not put it in client code.
- This version implements Brevo-backed signup verification and remote authentication. Existing ride, booking, wallet, lending, and notification screens use the app's current shared-state model and persist through the authenticated `/api/state` endpoint; this is a migration baseline, not a fully hardened transactional system. Before a public launch with real users, move each mutation to dedicated validated server endpoints with atomic booking/credit updates and authorization checks. Do not use it for real payments or sensitive data until that hardening and a security review are complete.
- The demo bootstrap contains demo profiles. Review/remove demo users before production.
- The health endpoint checks database connection by initializing the connection, so a cold start may take a few seconds.
