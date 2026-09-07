import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("OS-assigned port is available for dynamic relay origin", async () => {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  assert.equal(Number.isInteger(port), true);
  assert.equal(port > 0, true);
  await new Promise((resolve) => server.close(resolve));
});
