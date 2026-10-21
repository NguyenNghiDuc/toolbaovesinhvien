import { app } from './app.js';
import { db } from './db.js';
await db.user.count();
const server = app.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => console.log('StudentShield listening on port', process.env.PORT || 8080));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await db.$disconnect(); process.exit(0); }));
