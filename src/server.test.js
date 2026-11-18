import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./server.js";

test("health endpoint returns a minimal status without secrets", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch("http://127.0.0.1:" + address.port + "/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "base-ai-gateway" });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
