import jwt from 'jsonwebtoken';
import { AppError } from '../lib/errors.js';

export function authenticate(jwtSecret) {
  return (req, res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign-in is required.'));
    }

    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: 'slot-booking-api',
        audience: 'slot-booking-api'
      });
      if (typeof payload.sub !== 'string') throw new Error('Missing subject');
      req.auth = { userId: payload.sub };
      next();
    } catch {
      next(new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.'));
    }
  };
}
