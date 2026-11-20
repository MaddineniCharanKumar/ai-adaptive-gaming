# Adaptive Arcade — AI Reflex Trainer

A small browser-based reflex game that adjusts its challenge using a tabular Q-learning agent. There is no build step or server required.

## Run it

Open `index.html` in a modern browser, or serve this directory locally:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Play

Start a 60-second round and click each target before it disappears. Targets shrink and disappear faster as difficulty increases. Missing a target costs no points, but it counts as a miss and informs the agent. Pause/resume or restart at any time.

## How the learning works

- **State:** recent performance is classified as `struggling`, `balanced`, or `strong` using accuracy and reaction time.
- **Actions:** choose Easy, Medium, or Hard. Actions control target size and how long each target stays visible.
- **Reward:** successful hits are rewarded, fast hits earn a small bonus, and misses are penalized. The reward also discourages leaving a consistently strong player under-challenged.
- **Q-learning:** after each outcome, the agent updates its state/action value with `Q(s,a) ← Q(s,a) + α[r + γ max Q(s′,a′) − Q(s,a)]`. Exploration gradually decays to keep learning while using accumulated experience.
- **Persistence:** the Q-table, reaction history, and recent completed games are saved in browser `localStorage` on this device. Use the dashboard's **Clear** control to clear the game-history list.

## Project files

- `index.html` — game interface and dashboard
- `styles.css` — responsive visual design
- `app.js` — game loop, Q-learning, chart, and local persistence

## Notes

The game is a learning demo, not a trained model: Q-values adapt from play on the current browser. No player data is sent to a server. Fonts are loaded from Google Fonts when online; the game itself works without them.
