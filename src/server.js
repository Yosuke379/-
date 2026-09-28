import pg from 'pg';
import { createApp } from './app.js';
import { config } from './config/env.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'slot-booking-api'
});

const app = createApp({ pool, jwtSecret: config.JWT_SECRET });
const server = app.listen(config.PORT, () => {
  console.log('Slot Booking API listening on port ' + config.PORT);
});

async function shutdown(signal) {
  console.log(signal + ' received; shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection', error);
  process.exit(1);
});
