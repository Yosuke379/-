import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';

const passwordSchema = z.string()
  .min(12)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes.');

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must be at most 72 bytes.'
  )
}).strict();

export function createAuthRouter({ pool, jwtSecret }) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  });

  router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.validated.body;
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await pool.query(
        'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
        [id, email.toLowerCase(), passwordHash]
      );
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
      }
      throw error;
    }

    res.status(201).json({ data: { id, email: email.toLowerCase() } });
  }));

  router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.validated.body;
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const accessToken = jwt.sign({}, jwtSecret, {
      subject: user.id,
      issuer: 'slot-booking-api',
      audience: 'slot-booking-api',
      expiresIn: '1h'
    });

    res.json({ data: { accessToken, tokenType: 'Bearer', expiresIn: 3600 } });
  }));

  return router;
}
