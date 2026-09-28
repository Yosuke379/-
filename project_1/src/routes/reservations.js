import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { withTransaction } from '../lib/transaction.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const eventIdSchema = z.object({ eventId: z.string().uuid() }).strict();

export function createReservationsRouter({ pool, jwtSecret }) {
  const router = Router();
  const requireUser = authenticate(jwtSecret);

  router.post('/events/:eventId/reservations', requireUser, validate(eventIdSchema, 'params'),
    asyncHandler(async (req, res) => {
      const result = await withTransaction(pool, async (client) => {
        const eventResult = await client.query(
          'SELECT id, starts_at, capacity FROM events WHERE id = $1 FOR UPDATE',
          [req.params.eventId]
        );
        const event = eventResult.rows[0];
        if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event was not found.');
        if (new Date(event.starts_at).getTime() <= Date.now()) {
          throw new AppError(409, 'EVENT_ALREADY_STARTED', 'Reservations are closed after the event starts.');
        }

        const existingResult = await client.query(
          'SELECT id, status, created_at FROM reservations WHERE event_id = $1 AND user_id = $2 FOR UPDATE',
          [event.id, req.auth.userId]
        );
        const existing = existingResult.rows[0];
        if (existing?.status === 'confirmed') return { reservation: existing, created: false };

        const countResult = await client.query(
          "SELECT COUNT(*)::int AS count FROM reservations WHERE event_id = $1 AND status = 'confirmed'",
          [event.id]
        );
        if (countResult.rows[0].count >= event.capacity) {
          throw new AppError(409, 'EVENT_FULL', 'No seats remain for this event.');
        }

        if (existing) {
          const updated = await client.query(
            "UPDATE reservations SET status = 'confirmed', updated_at = now() WHERE id = $1" +
            ' RETURNING id, event_id, user_id, status, created_at, updated_at',
            [existing.id]
          );
          return { reservation: updated.rows[0], created: true };
        }

        const inserted = await client.query(
          "INSERT INTO reservations (id, event_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')" +
          ' RETURNING id, event_id, user_id, status, created_at, updated_at',
          [randomUUID(), event.id, req.auth.userId]
        );
        return { reservation: inserted.rows[0], created: true };
      });

      res.status(result.created ? 201 : 200).json({ data: result.reservation });
    })
  );

  router.delete('/events/:eventId/reservations/me', requireUser, validate(eventIdSchema, 'params'),
    asyncHandler(async (req, res) => {
      await withTransaction(pool, async (client) => {
        const eventResult = await client.query(
          'SELECT id FROM events WHERE id = $1 FOR UPDATE',
          [req.params.eventId]
        );
        const event = eventResult.rows[0];
        if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event was not found.');

        const reservationResult = await client.query(
          'SELECT id, status FROM reservations WHERE event_id = $1 AND user_id = $2 FOR UPDATE',
          [event.id, req.auth.userId]
        );
        const reservation = reservationResult.rows[0];
        if (!reservation) {
          throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
        }
        if (reservation.status === 'confirmed') {
          await client.query(
            "UPDATE reservations SET status = 'cancelled', updated_at = now() WHERE id = $1",
            [reservation.id]
          );
        }
      });
      res.status(204).end();
    })
  );

  router.get('/reservations/me', requireUser, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT r.id, r.status, r.created_at, r.updated_at,' +
      ' e.id AS event_id, e.title, e.starts_at' +
      ' FROM reservations r JOIN events e ON e.id = r.event_id' +
      ' WHERE r.user_id = $1 ORDER BY e.starts_at ASC, r.id ASC',
      [req.auth.userId]
    );
    res.json({ data: result.rows });
  }));

  return router;
}
