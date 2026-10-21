import http from 'node:http';
import { app } from './app.js';
import { db } from './db.js';
await db.user.count();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
// Express 5 can pass listen errors to its callback; use the HTTP server's
// listening event so a failed bind never prints a success message.
const server = http.createServer(app);
server.once('error', async error => {
  if (error.code === 'EADDRINUSE') console.error(`Không thể khởi động: cổng ${port} đang được ứng dụng khác sử dụng (EADDRINUSE). Dừng đúng ứng dụng đó hoặc chọn PORT khác và cập nhật APP_URL.`);
  else console.error(`Không thể mở máy chủ tại ${host}:${port} (${error.code || 'LISTEN_ERROR'}).`);
  await db.$disconnect();
  process.exitCode = 1;
});
server.listen(port, host, () => console.log('StudentShield listening on port', server.address().port));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  server.close(async () => { await db.$disconnect(); process.exitCode = 0; });
});
