import { createServer } from "vite";

// using the usual vite settings so requests and live updates reach the backend
const server = await createServer({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  plugins: [{
    name: "test-server-shutdown",
    configureServer(vite) {
      // handling shutdown requests before vite handles the page
      vite.middlewares.use((request, response, next) => {
        if (request.method !== "POST" || request.url !== "/__test__/shutdown") return next();
        if (request.headers.origin !== "http://127.0.0.1:5174" ||
            request.headers["x-csrf-protection"] !== "1") {
          response.writeHead(403).end();
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ stopped: true }));
        setImmediate(async () => { await vite.close(); });
      });
    },
  }],
});

await server.listen();
