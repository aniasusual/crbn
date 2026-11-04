// Fullstack Mobile Backend API: Adapt or expand endpoints as needed for your application.
import express from 'express';
import cors from 'cors';

const app = express();
// CRITICAL: Always bind to process.env.BACKEND_PORT || process.env.PORT to support dynamic workspace port allocation
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory data store for rapid fullstack prototyping (replace with SQLite or your chosen database)
let items = [
  {
    id: '1',
    title: 'Mobile app connected to Express backend',
    completed: true,
    timestamp: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Dynamic database and API endpoints ready',
    completed: true,
    timestamp: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Ready for AI agent to build custom features',
    completed: false,
    timestamp: new Date().toISOString(),
  },
];

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// GET all items
app.get('/api/items', (_req, res) => {
  res.json(items);
});

// POST new item
app.post('/api/items', (req, res) => {
  const newItem = {
    id: Date.now().toString(),
    title: req.body.title || 'Untitled Task',
    completed: Boolean(req.body.completed),
    timestamp: new Date().toISOString(),
    ...req.body,
  };
  items.unshift(newItem);
  res.status(201).json(newItem);
});

// PUT update item
app.put('/api/items/:id', (req, res) => {
  const index = items.findIndex((i) => i.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }
  items[index] = { ...items[index], ...req.body };
  res.json(items[index]);
});

// DELETE item
app.delete('/api/items/:id', (req, res) => {
  items = items.filter((i) => i.id !== req.params.id);
  res.json({ success: true, id: req.params.id });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API Server] Mobile backend active on http://127.0.0.1:${PORT}`);
});
