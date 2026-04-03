import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

interface WorkerHealthServerOptions {
  port: number;
}

export interface WorkerHealthServer {
  close: () => Promise<void>;
  setReady: (ready: boolean) => void;
}

const HEALTH_PATH = "/health";
const STATUS_STARTING = "starting";
const STATUS_OK = "ok";
const WORKER_SERVICE = "worker";

function writeJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: Record<string, unknown>
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

export function createWorkerHealthServer({
  port,
}: WorkerHealthServerOptions): WorkerHealthServer {
  let ready = false;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? HEALTH_PATH, "http://127.0.0.1");

    if (url.pathname !== HEALTH_PATH) {
      writeJson(response, 404, {
        status: "not_found",
        service: WORKER_SERVICE,
      });
      return;
    }

    writeJson(response, ready ? 200 : 503, {
      status: ready ? STATUS_OK : STATUS_STARTING,
      service: WORKER_SERVICE,
    });
  });

  server.listen(port, "0.0.0.0");

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    setReady: (nextReady) => {
      ready = nextReady;
    },
  };
}
