import { AppError } from '../lib/errors.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError(
        400,
        'VALIDATION_ERROR',
        'Request data is invalid.',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      ));
    }
    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}
