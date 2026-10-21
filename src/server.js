import { app } from './app.js';
import { pool, db } from './db.js';
await db.$queryRaw`SELECT 1`;
const server = app.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('StudentShield listening on port', process.env.PORT || 8080));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await db.$disconnect(); await pool.end(); process.exit(0); }));
