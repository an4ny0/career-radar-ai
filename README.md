

# 🛰️ CareerRadar.ai

**A live job-finding radar, built for the TinyFish Buildathon.**
Describe yourself once — the web agent sweeps live company career pages and ranks real openings against *your* profile.

**Live site → [https://career-radar-live.vercel.app](https://career-radar-live.vercel.app)**



---

## What it does

1. **Build your search** — role, opportunity types, skills, industries, location, work mode, minimum pay, availability, LinkedIn & profile context. Nothing runs without your own TinyFish key: the form stays greyed out and unclickable until you connect one.
2. **Watch the agent live** — a cinematic agent window narrates the real sweep: page discovery, full-posting extraction, scoring.
3. **Your shortlist** — up to 10 live opportunities, ranked locally against your profile with matched-skill reasons and a fit ring on every card (75+ green · 50–74 yellow · below 50 red).
4. **Inspect any result** — send a single listing through TinyFish's agent to verify it's a real, active opening.



## Highlights

- 🔑 **Strictly bring-your-own-key** — the API key lives client-side and is only used for your own searches; both server routes (`/api/search`, `/api/agent`) reject key-less requests
- 💾 **Saved session** — with a key connected, your preferences and last shortlist are saved on your device and restored automatically; clear the key and the site goes completely vanilla
- 🔒 Privacy-first: the key and profile data never touch a server-side store



## Tech stack

`Next.js 15 (App Router)` · `TypeScript` · `Three.js` globe · `TinyFish Search & Agent APIs` · no database, no user table — state lives in your browser only

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:3300](http://localhost:3300), hit **Connect API key**, paste your key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys), and run the radar.

---



Built by [an4ny0](https://github.com/an4ny0) for the TinyFish Buildathon · © 2026 CareerRadar.ai

