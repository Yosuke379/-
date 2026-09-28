import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { AppError } from './lib/errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createEventsRouter } from './routes/events.js';
import { createReservationsRouter } from './routes/reservations.js';

export function createApp({ pool, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.get('/healthz', async (req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v1/auth', createAuthRouter({ pool, jwtSecret }));
  app.use('/api/v1/events', createEventsRouter({ pool, jwtSecret }));
  app.use('/api/v1', createReservationsRouter({ pool, jwtSecret }));

  app.use((req, res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error({ requestId: req.requestId, error });
    res.status(status).json({
      error: {
        code: error.code ?? 'INTERNAL_SERVER_ERROR',
        message: status >= 500 ? 'An unexpected error occurred.' : error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId: req.requestId
      }
    });
  });

  return app;
}
