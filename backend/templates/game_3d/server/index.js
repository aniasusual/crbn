// STARTER BACKEND: Adapt or replace these mock routes and leaderboard data to match the requested game.
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory leaderboard store for games
let leaderboard = [
  { id: '1', player: 'CyberAce', score: 2500, time: '01:42', createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: '2', player: 'NovaRacer', score: 1850, time: '02:15', createdAt: new Date(Date.now() - 43200000).toISOString() },
  { id: '3', player: 'GlitchMaster', score: 1200, time: '03:01', createdAt: new Date(Date.now() - 10800000).toISOString() }
];

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'r3f_rapier', time: new Date().toISOString() });
});

// GET leaderboard scores
app.get('/api/scores', (req, res) => {
  res.json(leaderboard.sort((a, b) => b.score - a.score).slice(0, 10));
});

// POST submit new score
app.post('/api/scores', (req, res) => {
  const { player = 'Player', score = 0, time = '00:00' } = req.body;
  const newEntry = {
    id: Date.now().toString(),
    player: String(player).slice(0, 20),
    score: Number(score) || 0,
    time: String(time),
    createdAt: new Date().toISOString()
  };
  leaderboard.push(newEntry);
  leaderboard.sort((a, b) => b.score - a.score);
  res.status(201).json(newEntry);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Game API Server] Running on http://127.0.0.1:${PORT}`);
});
