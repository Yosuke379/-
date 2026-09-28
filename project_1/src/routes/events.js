import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { withTransaction } from '../lib/transaction.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const eventFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).nullable(),
  startsAt: z.string().datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), 'Event must start in the future.'),
  capacity: z.number().int().min(1).max(10000)
};

const createEventSchema = z.object(eventFields).strict();
const eventIdSchema = z.object({ eventId: z.string().uuid() }).strict();
const updateEventSchema = z.object({
  title: eventFields.title.optional(),
  description: eventFields.description.optional(),
  startsAt: eventFields.startsAt.optional(),
  capacity: eventFields.capacity.optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
}).strict();

const eventProjection = [
  'e.id, e.title, e.description, e.starts_at, e.capacity, e.created_at, e.created_by,',
  "COUNT(r.id) FILTER (WHERE r.status = 'confirmed')::int AS reserved_count,",
  "(e.capacity - COUNT(r.id) FILTER (WHERE r.status = 'confirmed'))::int AS remaining_seats"
].join(' ');

export function createEventsRouter({ pool, jwtSecret }) {
  const router = Router();
  const requireUser = authenticate(jwtSecret);

  router.get('/', validate(listQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { limit, offset } = req.validated.query;
    const result = await pool.query(
      'SELECT ' + eventProjection +
      ' FROM events e LEFT JOIN reservations r ON r.event_id = e.id' +
      ' GROUP BY e.id ORDER BY e.starts_at ASC, e.id ASC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ data: result.rows, pagination: { limit, offset } });
  }));

  router.get('/:eventId', validate(eventIdSchema, 'params'), asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT ' + eventProjection +
      ' FROM events e LEFT JOIN reservations r ON r.event_id = e.id' +
      ' WHERE e.id = $1 GROUP BY e.id',
      [req.params.eventId]
    );
    if (!result.rowCount) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    res.json({ data: result.rows[0] });
  }));

  router.post('/', requireUser, validate(createEventSchema), asyncHandler(async (req, res) => {
    const { title, description, startsAt, capacity } = req.validated.body;
    const id = randomUUID();
    const result = await pool.query(
      'INSERT INTO events (id, title, description, starts_at, capacity, created_by)' +
      ' VALUES ($1, $2, $3, $4, $5, $6)' +
      ' RETURNING id, title, description, starts_at, capacity, created_at, created_by',
      [id, title, description, startsAt, capacity, req.auth.userId]
    );
    res.status(201).json({
      data: { ...result.rows[0], reserved_count: 0, remaining_seats: capacity }
    });
  }));

  router.patch('/:eventId', requireUser, validate(eventIdSchema, 'params'), validate(updateEventSchema),
    asyncHandler(async (req, res) => {
      const patch = req.validated.body;
      const result = await withTransaction(pool, async (client) => {
        const eventResult = await client.query(
          'SELECT * FROM events WHERE id = $1 FOR UPDATE',
          [req.params.eventId]
        );
        const event = eventResult.rows[0];
        if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event was not found.');
        if (event.created_by !== req.auth.userId) {
          throw new AppError(403, 'FORBIDDEN', 'Only the event creator can edit this event.');
        }

        if (patch.capacity !== undefined) {
          const countResult = await client.query(
            "SELECT COUNT(*)::int AS count FROM reservations WHERE event_id = $1 AND status = 'confirmed'",
            [event.id]
          );
          if (patch.capacity < countResult.rows[0].count) {
            throw new AppError(
              409,
              'CAPACITY_BELOW_RESERVATIONS',
              'Capacity cannot be lower than the number of confirmed reservations.'
            );
          }
        }

        const columns = {
          title: 'title',
          description: 'description',
          startsAt: 'starts_at',
          capacity: 'capacity'
        };
        const values = [];
        const assignments = Object.entries(patch).map(([key, value]) => {
          values.push(value);
          return columns[key] + ' = $' + values.length;
        });
        values.push(event.id);
        const updated = await client.query(
          'UPDATE events SET ' + assignments.join(', ') + ', updated_at = now()' +
          ' WHERE id = $' + values.length +
          ' RETURNING id, title, description, starts_at, capacity, created_at, created_by',
          values
        );
        return updated.rows[0];
      });
      res.json({ data: result });
    })
  );

  return router;
}
