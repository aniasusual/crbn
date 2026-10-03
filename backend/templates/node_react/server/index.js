// STARTER BACKEND: Adapt or replace these mock routes and data store to match the requested application.
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.BACKEND_PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory data store for quick fullstack prototyping
let items = [
  {
    id: '1',
    title: 'Connect frontend to Express API endpoints',
    category: 'Backend',
    priority: 'high',
    done: true,
    createdAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: '2',
    title: 'Craft responsive UI design in src/App.jsx',
    category: 'Design',
    priority: 'medium',
    done: true,
    createdAt: new Date(Date.now() - 1800000).toISOString()
  },
  {
    id: '3',
    title: 'Prompt Lowkey AI to build your full-stack feature',
    category: 'AI',
    priority: 'high',
    done: false,
    createdAt: new Date().toISOString()
  }
];

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// GET all items
app.get('/api/items', (req, res) => {
  res.json(items);
});

// POST new item
app.post('/api/items', (req, res) => {
  const newItem = {
    id: Date.now().toString(),
    title: req.body.title || 'Untitled',
    done: Boolean(req.body.done),
    createdAt: new Date().toISOString(),
    ...req.body
  };
  items.unshift(newItem);
  res.status(201).json(newItem);
});

// PUT / PATCH update item
app.put('/api/items/:id', (req, res) => {
  const index = items.findIndex(i => i.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }
  items[index] = { ...items[index], ...req.body };
  res.json(items[index]);
});

// DELETE item
app.delete('/api/items/:id', (req, res) => {
  items = items.filter(i => i.id !== req.params.id);
  res.json({ success: true, id: req.params.id });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API Server] Running on http://127.0.0.1:${PORT}`);
});
