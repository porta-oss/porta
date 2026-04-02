import { createApiApp } from "./app";
import { createBootstrapDiagnostics, readApiEnv } from "./lib/env";

try {
  const env = readApiEnv(process.env, { strict: true });
  const app = await createApiApp(process.env, { env });

  app.listen({ port: env.apiPort, hostname: env.apiHost });

  console.info("[api] bootstrap ready", {
    edition: env.edition,
    apiHost: env.apiHost,
    apiPort: env.apiPort,
    apiUrl: env.apiUrl,
    webUrl: env.webUrl,
    authMountPath: app.runtime.auth.bootstrap.basePath,
    startupRoutePrefix: "/api/startups",
    connectorEncryptionReady: env.connectorEncryptionKey.length > 0,
  });
} catch (error) {
  console.error(
    "[api] bootstrap failed",
    createBootstrapDiagnostics(process.env, error)
  );
  process.exit(1);
}
