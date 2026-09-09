import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';

const server = http.createServer(createApp());

server.listen(config.port, config.host, () => {
  console.log(`The Wait is running on http://${config.host}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
