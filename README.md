# Waymate

Waymate is a React + Vite campus mobility frontend with an Express + MongoDB Atlas API.

## Architecture

- Frontend: React + Vite (deploy from repository root to Vercel)
- Backend: Express + Mongoose (deploy from `backend/` to Render)
- Database: MongoDB Atlas
- Authentication: bcrypt password hashing + signed JWTs
- Email verification: SMTP via Nodemailer (requires SMTP credentials)

## Local setup

### 1. Backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with a MongoDB Atlas connection string and a long random JWT secret. Keep this file private and never commit it.

Install and run:

```bash
npm install
npm run dev
```

The backend health endpoint is `http://localhost:5000/api/health`.

### 2. Frontend

In a second terminal at the repository root:

```bash
npm install
cp .env.example .env
npm run dev
```

The root `.env` should set `VITE_API_BASE_URL=http://localhost:5000/api`.

## Render deployment

Create a Render Web Service from this repository, with:

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Set these environment variables in Render:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas URI, including `/waymate` database |
| `JWT_SECRET` | Yes | Random secret, at least 32 characters |
| `CLIENT_ORIGIN` | Yes for production | Exact Vercel origin, e.g. `https://your-project.vercel.app` |
| `NODE_ENV` | Yes | `production` |
| `SMTP_HOST` | For real email verification | SMTP hostname from your email provider |
| `SMTP_PORT` | For real email verification | Usually 587 or 465 |
| `SMTP_USER` | For real email verification | SMTP username |
| `SMTP_PASS` | For real email verification | SMTP password or provider SMTP key |
| `EMAIL_FROM` | For real email verification | Verified sender address |

The app does not send email unless all four SMTP connection values and `EMAIL_FROM` are configured. In production, do not expose verification codes to the browser. Configure a real email provider before using registration with real users.

## Vercel deployment

Deploy the repository root as a Vite app:

- Framework preset: Vite
- Root Directory: `.`
- Build Command: `npm run build`
- Output Directory: `dist`

Set this Vercel environment variable for Production (and Preview if needed):

`VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com/api`

Redeploy after changing environment variables. Do not put MongoDB credentials, JWT secrets, or SMTP credentials in Vercel frontend variables.

Set Render `CLIENT_ORIGIN` to the exact deployed Vercel origin, without a trailing slash. Redeploy Render after changing it.

## Demo accounts

The backend seeds the nine bundled demo accounts only if those accounts do not already exist. Their passwords are `Waymate@1001` through `Waymate@1009`. These are public demo credentials; do not use demo accounts for private or production information.

## Important limitations and checks

- MongoDB is required at backend startup. If `MONGODB_URI` or `JWT_SECRET` is missing, the backend intentionally fails fast.
- Email verification requires SMTP settings. Without them, production signup will create a pending account but verification email delivery will not work.
- Community operations are synced through the authenticated state endpoint to preserve the existing frontend behavior. Before using this for real users or sensitive production data, move each ride/booking/wallet mutation into dedicated server-side operations with server-side authorization and atomic wallet/seat updates. Do not treat this initial integration as a security-audited production financial system.
- Verify the health endpoint, signup, email delivery, verification, login, ride creation/booking, and persistence in the deployed environment. A successful health check alone does not prove all flows work.


## Vercel deployment

See `VERCEL_DEPLOYMENT_GUIDE.md` for the one-project Vercel setup, MongoDB Atlas environment variables, and Brevo transactional email configuration.
