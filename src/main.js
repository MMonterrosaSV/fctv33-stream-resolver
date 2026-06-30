import { createServer } from "node:http";

import { handleRequest } from "./http/router.js";

const port = Number(process.env.PORT ?? "8787");

createServer(async (incoming, outgoing) => {
  const host = incoming.headers.host ?? `localhost:${port}`;
  const request = new Request(`http://${host}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers,
  });
  const response = await handleRequest(request);
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  console.log(`http://localhost:${port}`);
});
