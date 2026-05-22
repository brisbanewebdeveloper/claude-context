import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server as McpProtocolServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { ContextMcpConfig } from "./config.js";

type HttpMethod = "GET" | "POST" | "DELETE";
export type McpHttpTransport = Pick<StreamableHTTPServerTransport, "handleRequest">;

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
    });
    res.end(payload);
}

function writeText(res: ServerResponse, statusCode: number, text: string, headers: Record<string, string> = {}): void {
    res.writeHead(statusCode, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(text),
        ...headers
    });
    res.end(text);
}

function getRequestPath(req: IncomingMessage): string {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    const pathName = url.pathname;

    if (pathName.length > 1 && pathName.endsWith("/")) {
        return pathName.slice(0, -1);
    }

    return pathName;
}

export function createHttpRequestHandler(
    config: ContextMcpConfig,
    transport: McpHttpTransport
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return async (req, res) => {
        try {
            const requestPath = getRequestPath(req);

            if (requestPath === "/healthz") {
                writeJson(res, 200, {
                    status: "ok",
                    transport: "http",
                    mcpPath: config.httpPath
                });
                return;
            }

            if (requestPath !== config.httpPath) {
                writeJson(res, 404, {
                    error: "not_found",
                    message: `No route for ${requestPath}`
                });
                return;
            }

            if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
                writeText(res, 405, "Method Not Allowed", {
                    allow: "GET, POST, DELETE"
                });
                return;
            }

            await transport.handleRequest(req as IncomingMessage & { method: HttpMethod }, res);
        } catch (error: any) {
            console.error("[HTTP] Request handling failed:", error);
            if (!res.headersSent) {
                writeJson(res, 500, {
                    error: "internal_server_error",
                    message: error?.message || String(error)
                });
            } else {
                res.end();
            }
        }
    };
}

export async function startHttpTransport(
    server: McpProtocolServer,
    config: ContextMcpConfig
): Promise<HttpServer> {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
    });

    await server.connect(transport);

    const httpServer = createServer(createHttpRequestHandler(config, transport));

    await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(config.httpPort, config.httpHost, () => {
            httpServer.off("error", reject);
            resolve();
        });
    });

    console.log(`[HTTP] MCP server listening at http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
    console.log(`[HTTP] Health check available at http://${config.httpHost}:${config.httpPort}/healthz`);

    return httpServer;
}
