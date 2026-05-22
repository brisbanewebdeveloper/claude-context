import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpConfig } from "./config.js";

const HTTP_ENV_KEYS = [
    "MCP_TRANSPORT",
    "MCP_HTTP_HOST",
    "MCP_HTTP_PORT",
    "MCP_HTTP_PATH"
];

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
    const previous = new Map<string, string | undefined>();

    for (const key of [...HTTP_ENV_KEYS, ...Object.keys(values)]) {
        previous.set(key, process.env[key]);
        if (values[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = values[key];
        }
    }

    try {
        run();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test("uses stdio transport by default", () => {
    withEnv({}, () => {
        const config = createMcpConfig([]);

        assert.equal(config.transport, "stdio");
        assert.equal(config.httpHost, "127.0.0.1");
        assert.equal(config.httpPort, 3000);
        assert.equal(config.httpPath, "/mcp");
    });
});

test("reads HTTP transport configuration from environment", () => {
    withEnv({
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_PORT: "8787",
        MCP_HTTP_PATH: "/context"
    }, () => {
        const config = createMcpConfig([]);

        assert.equal(config.transport, "http");
        assert.equal(config.httpHost, "0.0.0.0");
        assert.equal(config.httpPort, 8787);
        assert.equal(config.httpPath, "/context");
    });
});

test("CLI HTTP transport options override environment values", () => {
    withEnv({
        MCP_TRANSPORT: "stdio",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: "3000",
        MCP_HTTP_PATH: "/mcp"
    }, () => {
        const config = createMcpConfig([
            "--transport", "http",
            "--host", "0.0.0.0",
            "--port", "9090",
            "--path", "/remote-mcp"
        ]);

        assert.equal(config.transport, "http");
        assert.equal(config.httpHost, "0.0.0.0");
        assert.equal(config.httpPort, 9090);
        assert.equal(config.httpPath, "/remote-mcp");
    });
});

test("rejects invalid HTTP transport configuration", () => {
    withEnv({}, () => {
        assert.throws(
            () => createMcpConfig(["--transport", "websocket"]),
            /Invalid MCP transport/
        );

        assert.throws(
            () => createMcpConfig(["--transport", "http", "--port", "0"]),
            /Invalid MCP HTTP port/
        );

        assert.throws(
            () => createMcpConfig(["--transport", "http", "--path", "mcp"]),
            /Invalid MCP HTTP path/
        );
    });
});
