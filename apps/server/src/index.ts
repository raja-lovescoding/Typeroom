import { createServer } from 'node:http';
import { app } from './http/app.js';
import { env } from './config/env.js';
import { createRealtimeServer } from './realtime/gateway.js';

const server = createServer(app);
createRealtimeServer(server);
server.listen(env.PORT, () => {
  console.log(`Typeroom server listening on ${env.PORT}`);
});
