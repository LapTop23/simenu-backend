require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const connectDB = require('./src/config/db');
const { notFoundHandler, globalErrorHandler } = require('./src/middleware/errorHandler');
const { initializeSocket } = require('./src/sockets');

const authRoutes = require('./src/routes/auth.routes');
const menuRoutes = require('./src/routes/menu.routes');
const orderRoutes = require('./src/routes/order.routes');
const restaurantRoutes = require('./src/routes/restaurant.routes');
const uploadRoutes = require('./src/routes/upload.routes');

const app = express();

// Socket.IO needs a raw http.Server to attach to — Express's `app` is just a
// request handler, not a server, so `app.listen()` (used previously) was
// secretly creating one anyway. Creating it explicitly here lets us hand the
// SAME server instance to both Express and Socket.IO, so REST and WebSocket
// traffic share one port instead of needing two.
const httpServer = http.createServer(app);

// ---------------------------------------------------------------------------
// Security & platform middleware
// ---------------------------------------------------------------------------

// Sets a battery of protective HTTP headers (CSP, no-sniff, frameguard, HSTS, etc.).
app.use(helmet());

// CORS is restricted to an explicit allow-list read from the environment, rather
// than left open (`origin: '*'`), since this API will be called from authenticated
// admin dashboards as well as public customer-facing menu pages.
const allowedOrigins = (process.env.CLIENT_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools (curl, Postman, server-to-server) which send no Origin header.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin "${origin}" is not permitted by CORS policy.`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' })); // JSON body parsing; capped to guard against oversized payloads.
app.use(express.urlencoded({ extended: true }));

// Parses the httpOnly login cookie (see auth.controller.js) into req.cookies,
// which requireAuth middleware then reads and verifies.
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Static file serving for uploaded menu images (see upload.middleware.js).
// Helmet's default Cross-Origin-Resource-Policy would otherwise block a
// frontend on a different origin from loading these images — relaxed
// specifically for this path, not globally.
// ---------------------------------------------------------------------------
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

// ---------------------------------------------------------------------------
// Health check — used by load balancers / uptime monitors, deliberately outside
// the tenant-resolution flow since it must succeed even with zero tenants configured.
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'si-menu-backend', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/uploads', uploadRoutes);

// ---------------------------------------------------------------------------
// Fallback + centralized error handling — MUST be registered last.
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(globalErrorHandler);

const PORT = process.env.PORT || 5000;

/**
 * Boot sequence: connect to MongoDB FIRST, and only start accepting HTTP traffic
 * once that connection is confirmed. This avoids a race condition where the
 * server accepts requests before it can actually serve any tenant's data.
 */
const startServer = async () => {
  await connectDB();

  // Attach Socket.IO to the same HTTP server Express is using, sharing the
  // CORS allow-list so a browser tab is either trusted for both REST and
  // WebSocket traffic, or neither.
  const io = initializeSocket(httpServer, allowedOrigins);
  app.set('io', io); // Exposed on the Express app in case a future REST route needs to emit an event.

  const server = httpServer.listen(PORT, () => {
    console.log(`[SI-Menu] Backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'} mode)`);
    console.log('[SI-Menu] Socket.IO is live on the same port.');
  });

  // Graceful shutdown — let in-flight requests finish before the process exits.
  const shutdown = (signal) => {
    console.log(`[SI-Menu] Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      console.log('[SI-Menu] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer();

module.exports = app;
