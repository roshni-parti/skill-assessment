# Deploying Level Readiness on Vercel

Sign-in is **work email + a 6-digit code**. Google sign-in is switched off for now (the code is still in the repo; it turns on when `GOOGLE_CLIENT_ID` is set). Real email delivery of codes is not built yet, so **only Roshni Parti can sign in**, with the code `999999`. Everyone else is told "Email codes are not switched on yet".

About 15 minutes. You need: the GitHub repo (already pushed), a Vercel account, and a database.

## Before real use
1. **Change the demo code.** `999999` is a default that anyone who knows the email could guess. As soon as you have tested, add the Vercel variable `DEMO_OTP` (exactly 6 digits) and redeploy. Roshni's account can see employee names, titles and managers.
2. **IT approval.** The tool stores a small slice of the employee master (id, name, work email, department, title, band, manager) on Neon and runs on Vercel. Bank, date-of-birth and address columns are never read.
3. **Vercel plan.** The free *Hobby* plan is for personal, non-commercial use. A company tool belongs on *Pro* or a company team.

## Step 1: Import the repo into Vercel
1. Go to <https://vercel.com/signup> and choose **Continue with GitHub**. Approve the permissions.
2. **Add New… → Project**, find `skill-assessment` and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and allow that repo.
3. **Framework Preset: Other.** Leave the build and output settings as they are (`vercel.json` sets them).
4. Don't click Deploy yet. Do Steps 2 and 3 first, in this same screen or in the project settings afterwards.

## Step 2: Add the database
1. In the project, open **Storage → Create Database → Neon** (Postgres). Accept the defaults, choose a region near your users, **Create**, and **connect it to this project** for all environments.
2. This adds `DATABASE_URL` automatically. Check under **Settings → Environment Variables**.

## Step 3: Add one secret
**Settings → Environment Variables → Add**:

| Name | Value |
|---|---|
| `SESSION_SECRET` | a long random string, e.g. run `openssl rand -base64 32`, or mash 40+ random characters |
| `DEMO_OTP` | optional, 6 digits: replaces `999999` (recommended after your first test) |
| `ADMIN_EMAILS` | optional extra admins, comma-separated (Roshni is always an admin) |

## Step 4: Deploy
**Deployments → Redeploy** (or **Deploy** if you came from the import screen). When it finishes, click **Visit**. That address is your link, e.g. `https://skill-assessment.vercel.app`.

If the page shows "Server is not configured yet: …", the message names the missing setting. Add it and redeploy.

## Step 5: Sign in
Open the link (works on a phone), enter `roshni.parti@rapido.bike`, tap **Send code**, enter `999999` (or your `DEMO_OTP`). You'll see **Quick demo** and **Manual role and level**.

## Step 6: Load the employees (enables "Take the test as another employee")
Do this from your own computer. The master file never goes to GitHub or Vercel.
1. In Neon (or Vercel → Storage → your database) copy the **connection string** (starts with `postgres://`).
2. In the project folder:
   ```
   npm install
   DATABASE_URL='postgres://…paste…' npm run import:employees -- "/path/to/Active and Inactive Employee Master.xlsx"
   ```
   (Windows PowerShell: `$env:DATABASE_URL='postgres://…'` on one line, then the `npm run …` line.)
3. It prints `Imported N active employees`. Refresh your Vercel page: the employee dropdown now fills in. Re-run it whenever the master changes.

## How level, function and manager are worked out
- **Function / role:** the employee's *Current Department* in Engineering (Fullstack → Developer, Mobile - Android, Mobile - IOS, QA, Data Engineering, Technical Support). Edit `data/level-map.json` to change it.
- **Level:** the *Band* (L-11 … L-4), or the *Current Designation* if the band is blank.
- **Manager:** the *Direct Manager*. Only that person can review (once real employee sign-in is on).
- **Not covered yet:** Devops, people at the top of their track, consultants with no band, and every function outside Engineering.

## Troubleshooting
1. **Use the production address.** On the project's **Overview** page, click the domain under *Domains* (like `skill-assessment-<team>.vercel.app`). Addresses with a random string in them are single deployments, and Vercel may ask you to log in to see them (Settings → Deployment Protection → Vercel Authentication).
2. **Open `<your address>/api/health`.** It shows what is working, with no secrets:
   - `{"ok":true,"database":true,"employees":N,"roles":7,"levelMap":true}`: all fine.
   - `"database":false` plus `databaseError`: the Neon database isn't connected to the **Production** environment, or the connection failed. Storage → your database → connect to the project, then Redeploy.
   - `{"error":"Server failed to start: …"}`: the message names the missing setting or file (for example `DATABASE_URL`).
   - `"employees":0`: the database is empty. Do Step 6 (the sign-in for Roshni works without it).
3. **Vercel's logs.** Project → **Logs**, filter to *Errors*. The first red line after you reload the page is the real cause. Paste it to whoever is helping you.
4. After changing an environment variable you must **Redeploy**; it doesn't apply to the running version.

## Later: let everyone sign in
- **Email codes:** needs an email sender (for example Resend or Amazon SES) and a table of one-time codes. The login screen and the `/api/auth/otp/request` + `/verify` endpoints are already the right shape.
- **Google sign-in:** create the OAuth client (see git history of this file), set `GOOGLE_CLIENT_ID` and redeploy.

## Running it on your own computer
```
npm install
npm run import:employees -- "/path/to/master.xlsx"   # fills a local database in data/dev-db
npm start                                              # http://localhost:3001, same email + code sign-in
npm test
```
