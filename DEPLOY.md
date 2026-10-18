# Deploying Level Readiness (GitHub + Neon + Google sign-in + Vercel)

Do the steps in order. Total time is about 45 minutes the first time.

## Before you start: two things to check with IT

1. **Employee data leaves Rapido's systems.** The tool stores a small slice of the employee master (id, name, work email, department, title, band, manager) in a database on Neon, and runs on Vercel. Get IT/security to approve this. The bank, date-of-birth, address and family columns in the master file are never read or stored.
2. **Vercel plan.** Vercel's free *Hobby* plan is for personal, non-commercial use. A company tool should run on a *Pro* plan or a team account the company pays for. You can try everything on Hobby, but move it before real employees use it.

---

## Step 1: Put the code on GitHub

1. Go to <https://github.com> and sign in (use *Sign up* if you don't have an account; verify your email).
2. Click **+ → New repository**. Name it `level-readiness`. Choose **Private**. Do **not** tick "Add a README". Click **Create repository**. Keep the page open; you need the repo URL (`https://github.com/<you>/level-readiness.git`).
3. Unzip the project I gave you and open a terminal in that folder (the one containing `package.json`).
4. Check that no secrets or employee files are included. This should print nothing:
   ```
   git ls-files | grep -Ei "xlsx|\.env$|dev-db|\.zip"
   ```
5. Connect and push:
   ```
   git remote add origin https://github.com/<you>/level-readiness.git
   git branch -M main
   git push -u origin main
   ```
   If Git asks you to sign in, use your GitHub username and a **personal access token** as the password (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → repository access: this repo, permission *Contents: Read and write*). Alternatively install the GitHub CLI and run `gh auth login`.

## Step 2: Create the Vercel project

1. Go to <https://vercel.com/signup> and choose **Continue with GitHub**. This is the account creation and the GitHub link in one step. Approve the permissions.
2. Click **Add New… → Project**. Under *Import Git Repository* find `level-readiness`. If it is missing, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
3. Framework Preset: **Other**. Leave the build settings alone (`vercel.json` already sets them). **Do not click Deploy yet**; add the environment variables first (Step 4). If it deploys anyway, that is fine, it will just redeploy later.

## Step 3: Create the database (Neon)

1. In your Vercel project open the **Storage** tab → **Create Database** → choose **Neon** (Postgres) → accept the defaults, pick a region near your users (for example Mumbai/Singapore) → **Create**, and **connect it to this project** (all environments).
2. Vercel adds an environment variable called `DATABASE_URL` for you. Confirm it under *Settings → Environment Variables*.

## Step 4: Google sign-in (Google Cloud)

You need to be (or ask) a Google Workspace admin for Rapido for the "Internal" option, which makes Google itself refuse anyone outside your organisation.

1. Go to <https://console.cloud.google.com>, sign in with your Rapido account, and create a project: **Select a project → New project →** name it `Level Readiness`.
2. Open **APIs & Services → OAuth consent screen** (newer consoles call this **Google Auth Platform**). Click **Get started**:
   - App name: `Level Readiness`; user support email: your email.
   - **Audience: Internal** (only users in your Rapido Google Workspace).
   - Contact email: your email. Finish.
3. Go to **Credentials → Create credentials → OAuth client ID** (in the new console: **Clients → Create client**):
   - Application type: **Web application**; name `Level Readiness web`.
   - **Authorized JavaScript origins**: add your Vercel address (you will know it after the first deploy, for example `https://level-readiness.vercel.app`) and, for local testing, `http://localhost:3001`. You do **not** need a redirect URI.
4. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). It is not a secret.

## Step 5: Environment variables on Vercel

Project → **Settings → Environment Variables** → add these for *Production* (and Preview if you want):

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from Step 4 |
| `SESSION_SECRET` | a long random string. Generate one with `openssl rand -base64 32` |
| `ADMIN_EMAILS` | optional extra admins, comma-separated. Roshni Parti is always an admin |
| `ALLOWED_EMAIL_DOMAIN` | optional, defaults to `rapido.bike` |

Then go to **Deployments → ⋯ → Redeploy**. Note your live address (for example `https://level-readiness.vercel.app`) and go back to Google Cloud (Step 4.3) to add it under *Authorized JavaScript origins* if you haven't.

## Step 6: Load the employees into the production database

On your own computer (this reads the master file locally; the file never goes to GitHub or Vercel):

1. In Neon (or Vercel → Storage → your database) copy the **connection string** (starts with `postgres://…`).
2. In the project folder run:
   ```
   npm install
   DATABASE_URL='postgres://…paste…' npm run import:employees -- "/path/to/Active and Inactive Employee Master.xlsx"
   ```
   (On Windows PowerShell: `$env:DATABASE_URL='postgres://…'` on one line, then the `npm run …` line.)
3. It prints `Imported N active employees`. Re-run it whenever the master changes (for example monthly): people who have left are removed, so they can no longer sign in.

## Step 7: Check it works

1. Open your Vercel address and click **Sign in with Google** using `roshni.parti@rapido.bike`. You should see **Quick demo**, **Take the test as another employee** and **Manual role and level**.
2. Pick an engineer in *Take the test as another employee*, complete it, then use **Review as manager (test)**.
3. Ask a real Engineering employee to sign in. They should see their function, level and manager already filled in, and a **Start my assessment** button. Their manager will see **Team reviews** with the waiting review.
4. Someone outside Engineering sees "The skill matrix for your function isn't ready yet". Someone on another domain, or not in the master data, is refused at sign-in.

Also turn on **Settings → Deployment Protection** for preview deployments so test URLs are not public.

## How the tool works out level, function and manager

- **Function / role:** the employee's *Current Department* in Engineering (Fullstack → Developer, Mobile - Android, Mobile - IOS, QA, Data Engineering, Technical Support). Edit `data/level-map.json` to change it.
- **Level:** the *Band* (L-11 … L-4) mapped per role; if the band is blank, the *Current Designation* is used instead (for example "Professional 2" → L-9).
- **Manager:** the *Direct Manager* in the master. Only that person can review.
- **Not covered yet:** Devops (no matrix), people at the top of their track, consultants with no band, and every function outside Engineering.

## Running it on your own computer

```
npm install
npm run import:employees -- "/path/to/master.xlsx"   # fills a local database in data/dev-db
npm start                                              # http://localhost:3001 (local sign-in by email; no Google needed)
npm test
```
When `GOOGLE_CLIENT_ID` is set, Google sign-in is used instead of the local sign-in. The local sign-in is always disabled in production.
