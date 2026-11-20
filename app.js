(() => {
  'use strict';

  const LEVELS = [
    { name: 'Easy', size: 68, window: 1900, color: '#b59bff' },
    { name: 'Medium', size: 54, window: 1350, color: '#7de2e4' },
    { name: 'Hard', size: 42, window: 900, color: '#ff9bba' }
  ];
  const SESSION_SECONDS = 60;
  const ALPHA = 0.25;
  const GAMMA = 0.8;
  const STORAGE_KEY = 'adaptive-arcade-v1';
  const $ = (id) => document.getElementById(id);
  const els = {
    target: $('target'), playfield: $('playfield'), idle: $('idle-message'), timer: $('timer'), score: $('score'),
    difficulty: $('difficulty-label'), accuracy: $('accuracy'), accuracyNote: $('accuracy-note'), reaction: $('reaction'),
    streak: $('best-streak'), adjustments: $('adjustments'), learningCount: $('learning-count'), learningMessage: $('learning-message'),
    meter: $('learning-meter-fill'), chart: $('reaction-chart'), chartEmpty: $('chart-empty'), history: $('history-list'),
    start: $('start-button'), pause: $('pause-button'), restart: $('restart-button'), paused: $('paused-overlay'),
    feedback: $('feedback'), status: $('ai-status')
  };

  function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        q: saved.q && typeof saved.q === 'object' ? saved.q : {},
        observations: Number.isFinite(saved.observations) ? saved.observations : 0,
        games: Array.isArray(saved.games) ? saved.games.slice(0, 8) : [],
        hits: Array.isArray(saved.hits) ? saved.hits.slice(-30) : []
      };
    } catch (_) {
      return { q: {}, observations: 0, games: [], hits: [] };
    }
  }
  const saved = loadSaved();
  let qTable = saved.q;
  let observations = saved.observations;
  let gameHistory = saved.games;
  let hitHistory = saved.hits;
  let running = false;
  let paused = false;
  let secondsLeft = SESSION_SECONDS;
  let score = 0;
  let attempts = 0;
  let hits = 0;
  let streak = 0;
  let bestStreak = 0;
  let adjustments = 0;
  let difficulty = 0;
  let currentState = 'balanced';
  let currentAction = 0;
  let startedAt = 0;
  let tickInterval = null;
  let targetTimeout = null;
  let feedbackTimeout = null;
  let lastReactionMs = null;
  let epsilon = 0.18;

  const stateNames = ['struggling', 'balanced', 'strong'];
  const qValues = (state) => {
    if (!Array.isArray(qTable[state])) qTable[state] = [0, 0, 0];
    return qTable[state];
  };
  function chooseAction(state, current) {
    const values = qValues(state);
    if (Math.random() < epsilon) return Math.floor(Math.random() * LEVELS.length);
    const max = Math.max(...values);
    const ties = values.map((value, index) => ({ value, index })).filter((item) => item.value === max).map((item) => item.index);
    return ties.includes(current) ? current : ties[Math.floor(Math.random() * ties.length)];
  }
  function classifyState() {
    const recent = recentResults.slice(-5);
    if (recent.length < 2) return 'balanced';
    const accuracy = recent.filter((result) => result.hit).length / recent.length;
    const reactions = recent.filter((result) => result.hit).map((result) => result.ms);
    const avg = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : Infinity;
    const expected = LEVELS[difficulty].window;
    if (accuracy < 0.5 || avg > expected * 0.76) return 'struggling';
    if (accuracy >= 0.82 && avg < expected * 0.52) return 'strong';
    return 'balanced';
  }
  let recentResults = [];

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ q: qTable, observations, games: gameHistory, hits: hitHistory })); }
    catch (_) { /* Storage may be disabled or full; the current game still works. */ }
  }
  function renderStats() {
    const accuracy = attempts ? Math.round((hits / attempts) * 100) : null;
    const avg = hitHistory.length ? Math.round(hitHistory.reduce((sum, item) => sum + item.ms, 0) / hitHistory.length) : null;
    els.score.textContent = String(score);
    els.accuracy.innerHTML = accuracy === null ? '—<small>%</small>' : `${accuracy}<small>%</small>`;
    els.accuracyNote.textContent = attempts ? `${hits} hits · ${attempts - hits} misses` : 'No attempts yet';
    els.reaction.innerHTML = avg === null ? '—<small> ms</small>' : `${avg}<small> ms</small>`;
    els.streak.textContent = String(bestStreak);
    els.adjustments.textContent = String(adjustments);
    els.difficulty.textContent = LEVELS[difficulty].name;
    els.difficulty.style.color = LEVELS[difficulty].color;
    els.learningCount.textContent = `${observations} observation${observations === 1 ? '' : 's'}`;
    els.meter.style.width = `${Math.min(100, (observations / 30) * 100)}%`;
    if (observations === 0) els.learningMessage.textContent = 'Play a few targets to help the AI find your sweet spot.';
    else if (observations < 8) els.learningMessage.textContent = 'The AI is getting to know your reaction speed and accuracy.';
    else els.learningMessage.textContent = `The AI is adapting to your ${currentState} play style.`;
    drawChart();
    renderHistory();
  }
  function drawChart() {
    const canvas = els.chart;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    const values = hitHistory.slice(-12).map((item) => item.ms);
    els.chartEmpty.hidden = values.length > 0;
    if (!values.length) return;
    const left = 8, right = width - 8, top = 10, bottom = height - 14;
    const max = Math.max(2500, ...values) * 1.05;
    const min = Math.max(0, Math.min(...values) * 0.65);
    ctx.strokeStyle = '#30364d'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = top + ((bottom - top) * i) / 2;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }
    const points = values.map((value, index) => ({
      x: values.length === 1 ? (left + right) / 2 : left + (index * (right - left)) / (values.length - 1),
      y: bottom - ((Math.max(min, Math.min(max, value)) - min) / (max - min || 1)) * (bottom - top)
    }));
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, '#9b7cff44'); gradient.addColorStop(1, '#9b7cff00');
    ctx.beginPath(); ctx.moveTo(points[0].x, bottom); points.forEach((point) => ctx.lineTo(point.x, point.y)); ctx.lineTo(points[points.length - 1].x, bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.strokeStyle = '#a48aff'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    points.forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#d5c7ff'; ctx.fill(); });
  }
  function renderHistory() {
    if (!gameHistory.length) { els.history.innerHTML = '<div class="history-empty">Complete a game to see it here.</div>'; return; }
    els.history.innerHTML = gameHistory.slice(0, 5).map((game) => `<div class="history-row"><strong>${game.score} pts</strong><span class="history-meta">${game.accuracy}% accuracy</span><span class="history-level">${escapeHTML(game.level)}</span></div>`).join('');
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function feedback(text, bad = false) {
    els.feedback.textContent = text;
    els.feedback.classList.toggle('bad', bad);
    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => { els.feedback.textContent = ''; }, 650);
  }
  function placeTarget() {
    if (!running || paused) return;
    const bounds = els.playfield.getBoundingClientRect();
    const size = LEVELS[difficulty].size;
    const margin = size / 2 + 12;
    const x = margin + Math.random() * Math.max(0, bounds.width - margin * 2);
    const y = margin + Math.random() * Math.max(0, bounds.height - margin * 2);
    els.target.style.width = `${size}px`;
    els.target.style.height = `${size}px`;
    els.target.style.left = `${x}px`;
    els.target.style.top = `${y}px`;
    els.target.hidden = false;
    startedAt = performance.now();
    clearTimeout(targetTimeout);
    targetTimeout = setTimeout(() => resolveRound(false, null), LEVELS[difficulty].window);
  }
  function updateLearning(hit, reactionMs, timedOut = false) {
    attempts += 1;
    if (hit) { hits += 1; streak += 1; bestStreak = Math.max(bestStreak, streak); }
    else streak = 0;
    const outcomeState = classifyState();
    const reward = hit
      ? (outcomeState === 'strong' && difficulty < 2 ? 0.45 : 1 + (reactionMs < LEVELS[difficulty].window * 0.45 ? 0.25 : 0))
      : -1.25;
    const values = qValues(currentState);
    const nextState = classifyState();
    const nextBest = Math.max(...qValues(nextState));
    values[currentAction] += ALPHA * (reward + GAMMA * nextBest - values[currentAction]);
    observations += 1;
    currentState = nextState;
    const chosen = chooseAction(currentState, difficulty);
    if (chosen !== difficulty) adjustments += 1;
    difficulty = chosen;
    currentAction = chosen;
    epsilon = Math.max(0.05, 0.18 * Math.pow(0.995, observations));
    recentResults.push({ hit, ms: reactionMs || 0, timeout: timedOut });
    recentResults = recentResults.slice(-8);
    if (hit) {
      hitHistory.push({ ms: reactionMs, at: Date.now() });
      hitHistory = hitHistory.slice(-30);
      score += Math.max(10, Math.round(100 * (1 - Math.min(reactionMs, LEVELS[difficulty].window) / (LEVELS[difficulty].window * 1.5))));
    }
    persist();
    renderStats();
  }
  function resolveRound(hit, reactionMs) {
    if (!running || paused || els.target.hidden) return;
    clearTimeout(targetTimeout);
    els.target.hidden = true;
    if (hit) feedback(`+${Math.max(10, Math.round(100 * (1 - Math.min(reactionMs, LEVELS[difficulty].window) / (LEVELS[difficulty].window * 1.5))))} · ${Math.round(reactionMs)} ms`);
    else feedback('Missed — the AI is easing up', true);
    updateLearning(hit, reactionMs, !hit);
    if (running && !paused) setTimeout(placeTarget, hit ? 180 : 350);
  }
  function finishGame() {
    if (!running) return;
    running = false; paused = false;
    clearInterval(tickInterval); clearTimeout(targetTimeout);
    els.target.hidden = true; els.paused.hidden = true;
    els.pause.disabled = true; els.pause.innerHTML = 'Ⅱ <span>Pause</span>';
    els.start.disabled = false; els.start.innerHTML = '<span>▶</span> Play again';
    els.status.textContent = 'AI ready for another round';
    if (attempts > 0) {
      gameHistory.unshift({ score, accuracy: Math.round((hits / attempts) * 100), level: LEVELS[difficulty].name, date: Date.now() });
      gameHistory = gameHistory.slice(0, 8);
      persist(); renderHistory();
      feedback(`Round complete · ${score} points`);
    }
  }
  function startGame() {
    clearInterval(tickInterval); clearTimeout(targetTimeout);
    running = true; paused = false; secondsLeft = SESSION_SECONDS; score = 0; attempts = 0; hits = 0; streak = 0; bestStreak = 0; adjustments = 0;
    recentResults = []; difficulty = 0; currentState = 'balanced'; currentAction = 0;
    els.timer.textContent = String(secondsLeft); els.idle.hidden = true; els.paused.hidden = true;
    els.start.disabled = true; els.start.innerHTML = '<span>▶</span> Playing';
    els.pause.disabled = false; els.status.textContent = 'AI is learning from your play';
    renderStats(); placeTarget();
    tickInterval = setInterval(() => {
      if (paused || !running) return;
      secondsLeft -= 1; els.timer.textContent = String(secondsLeft);
      if (secondsLeft <= 0) finishGame();
    }, 1000);
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    els.paused.hidden = !paused;
    els.pause.innerHTML = paused ? '▶ <span>Resume</span>' : 'Ⅱ <span>Pause</span>';
    if (paused) {
      clearTimeout(targetTimeout); els.target.hidden = true; els.status.textContent = 'Game paused';
    } else {
      els.status.textContent = 'AI is learning from your play'; placeTarget();
    }
  }
  els.target.addEventListener('click', () => {
    if (!running || paused) return;
    resolveRound(true, performance.now() - startedAt);
  });
  els.start.addEventListener('click', startGame);
  els.pause.addEventListener('click', togglePause);
  els.restart.addEventListener('click', () => {
    if (running) finishGame();
    els.idle.hidden = false; els.timer.textContent = String(SESSION_SECONDS); startGame();
  });
  $('clear-history').addEventListener('click', () => { gameHistory = []; persist(); renderHistory(); });
  window.addEventListener('resize', drawChart);
  renderStats();
})();
