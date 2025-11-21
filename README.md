# DraftKings NBA Lineup Optimizer

<img src="public/favicon.ico" width=100 /><img src="public/favicon.ico" width=100 /><img src="public/favicon.ico" width=100 /><img src="public/favicon.ico" width=100 /><img src="public/favicon.ico" width=100 />

A web app that helps you build **NBA DraftKings lineups** by ranking players with a simple, transparent efficiency metric and suggesting a lineup that fits under the salary cap.

The goal isn’t to “solve” DFS, but to give you a fast, visual way to:

- Upload DraftKings salary data
- See which players project as the best point-per-dollar options
- Auto-generate a core lineup you can tweak before submitting on DraftKings

> **Disclaimer:** This project is for educational and entertainment purposes only.  
> It is **not** affiliated with DraftKings, and it does **not** guarantee profits or winnings.
> [![Built with React](https://img.shields.io/badge/Built%20with-React-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Built with Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ Features

- **CSV Upload:** Import the standard DraftKings player CSV for NBA contests.
- **Player Ranking:** Compute a custom **efficiency score** that balances salary vs. fantasy production.
- **Lineup Generation:** Build a recommended lineup that:
- Respects DraftKings position rules
- Stays under the $50,000 salary cap
- **Player Cards:** Show key info like:
- Name, team, opponent, and game info
- Salary and average DraftKings points
- Custom efficiency metric
- **Matchup Strip:** Horizontal strip of games so you can see which matchups your lineup targets.
- **Responsive UI:** Built to look good on desktop and laptop resolutions (portfolio-friendly).

---

## 🧮 Efficiency Metric

Each player gets an **efficiency** score that favors high production at lower salary.

A simple example formula:

efficiency = avgDKPoints / (salary / 1000)

- Higher `avgDKPoints` increases the score.
- Higher `salary` decreases the score.
- Players with strong production at a discount rise to the top.

The exact formula can be tuned in your utility functions (e.g. in a `utils` folder).

---

## 🧱 Tech Stack

- **Framework:** Next.js (React)
- **Language:** TypeScript
- **Styling:** Tailwind CSS / CSS modules
- **UI Components:** Custom React components
- **Data:** DraftKings CSV + optional cached JSON (e.g. `cache_players.json`)
- **Deployment:** Vercel

There may also be some **Python** tooling in the repo used for data scripts and experimentation; it is not required to run the core Next.js app.
Python was used in place of APIs when the APIs started charging insane amounts to use them.

---

## 📂 Project Structure (Example)

.
├── public/              # Static assets (icons, images, favicon, logo)
├── src/
│   ├── app/             # Next.js app router routes (layout, pages, API)
│   ├── components/      # UI components (player cards, matchup strip, layout)
│   └── utils/           # Lineup logic, efficiency calculation, CSV parsing
├── styles/              # Global styles, Tailwind setup
├── cache_players.json   # Optional cached player data for demo/offline use
├── next.config.js       # Next.js configuration
└── package.json         # Dependencies and scripts

Your actual structure may vary a bit, but this is the general idea.

---

## 📎 Using the App

### 1. Get the DraftKings CSV

1. Go to **DraftKings → NBA → Classic** contest.
2. On the contest page, click **Download Players List (CSV)**.
3. Save the file to your computer, e.g. `DKSalaries.csv`.

### 2. Load players into the app

1. Open the deployed app (Vercel) or your local dev server.
2. Use the **Upload CSV** control to select your `DKSalaries.csv` file.
3. The app parses the CSV and shows:
- A list of players with salary and average DK points
- An efficiency score for each player
- Games/matchups across the slate

### 3. Generate a lineup

1. Click **Generate Lineup**.
2. The app will:
- Rank players by efficiency
- Respect DraftKings roster slots (PG, SG, SF, PF, C, G, F, UTIL)
- Keep the total salary at or under $50,000
3. You’ll see:
- A list of 8 recommended players
- Total salary and approximate projection
- Visual indicators for matchups/teams

Use this as a **starting point**, then tweak manually inside DraftKings with your own strategy.

---

## 🚀 Getting Started (Local Development)

### Prerequisites

- Node.js (v18+ recommended)
- npm or yarn

### 1. Clone the repo

git clone <YOUR_REPO_URL_HERE>
cd draftkings-optimizer

### 2. Install dependencies

npm install
# or
yarn

### 3. Run the dev server

npm run dev
# or
yarn dev

Then open:

- http://localhost:3000

You should see the DraftKings optimizer UI.

---

## ⚙️ Environment Variables (Optional)

By default, the app can run against **cached data** (e.g. `cache_players.json` or the uploaded CSV) so you can demo it without external APIs.

If you connect a live stats or projections API, you might add environment variables like:

RAPIDAPI_KEY=your_key_here
API_BASE_URL=https://example-nba-endpoint.com

and access them in Next.js via `process.env`.

(Exact names depend on how you wire the API into your `utils` or API routes.)

---

## 🧪 Project Status

This project is a **portfolio-ready prototype**:

- Core flow:
- Upload DraftKings CSV
- Rank players by efficiency
- Generate a valid lineup under the cap
- Built to showcase:
- Modern React / Next.js skills
- TypeScript and utility-driven logic
- UI work around data-heavy content

Future improvements could include:

- Support for more contest types (Showdown, tiers, etc.)
- Smarter projection models (minutes, injuries, pace)
- Lock/exclude players for custom builds
- Multiple lineup generation and diversification
- Persisting settings in local storage or a database
- Better visualizations of exposure and salary allocation

---

## 🙌 Contributing / Feedback

This is primarily a personal project and learning tool, but:

- Suggestions for features, UI improvements, or lineup logic are welcome.
- If you fork it and build something cool on top, feel free to share.

---

## 📜 Legal & Responsible Use

- Not affiliated with or endorsed by **DraftKings**, the NBA, or any team.
- All names and trademarks belong to their respective owners.
- Daily fantasy sports involve risk; always play responsibly and within your means.

---
