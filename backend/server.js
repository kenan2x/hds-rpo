require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { initDatabase, closeDatabase } = require('./models/database');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---------------------------------------------------------------------------
// Initialize database before starting the server
// ---------------------------------------------------------------------------
initDatabase();

// ---------------------------------------------------------------------------
// Create Express app
// ---------------------------------------------------------------------------
const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Disabled so the React SPA can load inline scripts/styles
  })
);

// CORS — allow all origins in development, restrict in production as needed
app.use(
  cors({
    origin: NODE_ENV === 'production' ? false : true,
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (lightweight, no external dependency)
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/config', require('./routes/config'));
app.use('/api/storages', require('./routes/storages'));
app.use('/api/monitoring', require('./routes/monitoring'));
app.use('/api/alerts', require('./routes/alerts'));

// ---------------------------------------------------------------------------
// Serve React SPA static files (production)
// ---------------------------------------------------------------------------
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// SPA catch-all: any route that does not match an API endpoint serves index.html
// so that React Router can handle client-side routing.
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      // If index.html doesn't exist (e.g., dev mode without a build), return 404
      res.status(404).json({ error: 'Frontend not built. Run the frontend build first.' });
    }
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(`[error] ${err.stack || err.message || err}`);
  const status = err.status || 500;
  res.status(status).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`[server] Hitachi RPO Monitor backend running on port ${PORT} (${NODE_ENV})`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function gracefulShutdown(signal) {
  console.log(`\n[server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    closeDatabase();
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
