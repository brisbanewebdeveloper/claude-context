import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { createHttpRequestHandler } from "./http.js";
import type { McpHttpTransport } from "./http.js";
import type { ContextMcpConfig } from "./config.js";

const baseConfig: ContextMcpConfig = {
    name: "test",
    version: "1.0.0",
    transport: "http",
    httpHost: "127.0.0.1",
    httpPort: 0,
    httpPath: "/mcp",
    embeddingProvider: "Ollama",
    embeddingModel: "nomic-embed-text"
};

async function withServer(
    transport: McpHttpTransport,
    run: (baseUrl: string) => Promise<void>
): Promise<void> {
    const server = createServer(createHttpRequestHandler(baseConfig, transport));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
    }

    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}

function createTransport(): McpHttpTransport & { calls: number } {
    const transport = {
        calls: 0,
        async handleRequest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
            transport.calls++;
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ delegated: true }));
        }
    };
    return transport;
}

test("health check returns JSON without delegating to MCP transport", async () => {
    const transport = createTransport();

    await withServer(transport, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/healthz`);
        const body = await readJson(response);

        assert.equal(response.status, 200);
        assert.equal(body.status, "ok");
        assert.equal(body.mcpPath, "/mcp");
        assert.equal(transport.calls, 0);
    });
});

test("unknown routes return not found without delegating", async () => {
    const transport = createTransport();

    await withServer(transport, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/missing`);
        const body = await readJson(response);

        assert.equal(response.status, 404);
        assert.equal(body.error, "not_found");
        assert.equal(transport.calls, 0);
    });
});

test("unsupported methods on MCP path return method not allowed", async () => {
    const transport = createTransport();

    await withServer(transport, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp`, { method: "PUT" });
        const text = await response.text();

        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET, POST, DELETE");
        assert.equal(text, "Method Not Allowed");
        assert.equal(transport.calls, 0);
    });
});

test("MCP path delegates supported methods to the transport", async () => {
    const transport = createTransport();

    await withServer(transport, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
        const body = await readJson(response);

        assert.equal(response.status, 200);
        assert.equal(body.delegated, true);
        assert.equal(transport.calls, 1);
    });
});
