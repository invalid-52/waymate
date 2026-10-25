# Waymate deployment checklist

Use `VERCEL_DEPLOYMENT_GUIDE.md` for the single-project Vercel deployment. This project includes the Vite frontend and a Vercel serverless Express API under `api/[path].js`, `api/app/[path].js`, `api/auth/[path].js`, and `api/user/[path].js`.

Required Vercel environment variables: `VITE_API_BASE_URL=/api`, `MONGODB_URI`, `JWT_SECRET`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME=Waymate`, `CLIENT_ORIGIN`, and `NODE_ENV=production`.

Do not commit `.env` files or share API keys/passwords. Rotate the MongoDB password that appeared in a screenshot before deployment.
