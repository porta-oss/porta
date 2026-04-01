import { createApiApp } from './app';
import { readApiEnv } from './lib/env';

const env = readApiEnv(process.env);
const app = createApiApp(process.env);

app.listen(env.apiPort);

console.info('[api] bootstrap ready', {
  apiPort: env.apiPort,
  apiUrl: env.apiUrl,
  webUrl: env.webUrl,
  startupRoutePrefix: '/api/startups'
});
