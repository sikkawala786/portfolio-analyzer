# Portfolio Analyzer

Scans a public GitHub profile and scores it the way a hiring manager or freelance
client actually would — then gets a direct, written review from Claude.

**Live demo:** _add your deployed link here once you've deployed it (see below)_

![Screenshot](docs/screenshot.png)
_(add a screenshot here — see "Before you push" below)_

## What it does

1. You enter a GitHub username.
2. The app pulls the profile's public, non-fork repos from the GitHub REST API,
   and inspects the top 6 (by stars, then recency): README content, homepage
   links, and recent commit history.
3. A deterministic scoring function (see `client/src/App.jsx` → `computeScores`)
   rates the profile 0–100 across four categories:
   - **README quality** — presence, length, images, code blocks
   - **Commit activity** — how many repos have been touched in the last 90 days
   - **Live demo presence** — homepage field or a deploy link (Vercel, Netlify,
     GitHub Pages, Render, Railway, etc.) mentioned in the README
   - **Tech stack diversity** — number of distinct languages across repos
4. The scores and repo summary are sent to Claude (via our own backend, so the
   API key never touches the browser), which returns a short human-style
   verdict and three concrete "quick wins."

Scoring is deterministic and computed in code — the AI is only used to explain
the scores in plain language, not to invent them.

## Project structure

```
portfolio-analyzer/
├── client/          Vite + React frontend
│   └── src/App.jsx  All UI, GitHub API calls, and scoring logic
├── server/
│   └── index.js     Express server: serves the built frontend +
│                     the /api/feedback endpoint that calls Claude
├── .env.example
└── package.json      root scripts (build/start)
```

## Run it locally

Requires Node 18+.

```bash
# 1. install dependencies (root + client)
npm run install:all

# 2. add your Anthropic API key
cp .env.example .env
# then edit .env and paste your key from https://console.anthropic.com/settings/keys

# 3. run the backend (terminal 1)
npm run dev:server

# 4. run the frontend (terminal 2)
npm run dev:client
```

Open the URL Vite prints (usually `http://localhost:5173`). The frontend proxies
`/api/*` requests to the backend on port 3001, so both need to be running.

## Deploy it (one service, free tier friendly)

The backend serves the built frontend, so you only need to deploy **one**
service — no separate frontend/backend hosting or CORS setup needed.

**Render (recommended, has a free tier):**

1. Push this repo to GitHub.
2. On [render.com](https://render.com), create a **New Web Service** from your repo.
3. Set:
   - **Build command:** `npm run build`
   - **Start command:** `npm start`
4. Add an environment variable: `ANTHROPIC_API_KEY` = your key.
5. Deploy. Render gives you a live `.onrender.com` URL — put that on your resume.

**Railway** works the same way (build command `npm run build`, start command
`npm start`, same env variable).

## Before you push this to GitHub

Since this project's entire pitch is "your README and live demo matter" —
make sure this one practices what it preaches:

- [ ] Add a real screenshot or short GIF of the app in action (replace the
      placeholder above)
- [ ] Fill in the live demo link once deployed
- [ ] Never commit your `.env` file (already covered by `.gitignore`)
- [ ] Rename `App.jsx`'s default export / project name if you want your own
      branding

## Tech stack

React · Vite · Express · Recharts · GitHub REST API · Claude API (`claude-sonnet-5`)
