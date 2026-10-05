# Spoken English 3x Referral Tree — Vercel + MongoDB

## Deploy
1. Upload this project to GitHub.
2. Import the GitHub repo into Vercel.
3. Framework Preset: Other.
4. No build command is required.
5. Add these Environment Variables in Vercel:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `ADMIN_EMAIL`
6. Deploy.

## MongoDB Atlas
Allow the Vercel deployment to reach Atlas. For a simple Atlas setup, add the appropriate network access rule in Atlas and use a database user with the required permissions.

## Test after deployment
Open:
`https://YOUR-DOMAIN.vercel.app/api/health`

It should return:
`{"ok":true,"database":"connected"}`

## Local
npm install
npx vercel dev

Do not commit `.env`.
