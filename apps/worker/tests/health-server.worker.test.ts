import { afterEach, describe, expect, test } from "vitest";

import { createWorkerHealthServer } from "../src/health-server";

const activeServers = new Set<{ close: () => Promise<void> }>();

afterEach(async () => {
  await Promise.all(
    Array.from(activeServers, async (server) => {
      await server.close();
      activeServers.delete(server);
    })
  );
});

async function requestJson(port: number, path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);

  return {
    body: await response.json(),
    status: response.status,
  };
}

describe("createWorkerHealthServer", () => {
  test("reports starting until marked ready", async () => {
    const server = createWorkerHealthServer({ port: 32_111 });
    activeServers.add(server);

    const starting = await requestJson(32_111, "/health");

    expect(starting.status).toBe(503);
    expect(starting.body).toEqual({
      status: "starting",
      service: "worker",
    });

    server.setReady(true);

    const ready = await requestJson(32_111, "/health");

    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      status: "ok",
      service: "worker",
    });
  });

  test("returns not_found for unknown paths", async () => {
    const server = createWorkerHealthServer({ port: 32_112 });
    activeServers.add(server);

    const response = await requestJson(32_112, "/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      status: "not_found",
      service: "worker",
    });
  });
});
