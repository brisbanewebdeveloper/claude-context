import { envManager } from "@zilliz/claude-context-core";

export interface ContextMcpConfig {
    name: string;
    version: string;
    transport: 'stdio' | 'http';
    httpHost: string;
    httpPort: number;
    httpPath: string;
    // Embedding provider configuration
    embeddingProvider: 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama' | 'OpenRouter';
    embeddingModel: string;
    // Provider-specific API keys
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    voyageaiApiKey?: string;
    geminiApiKey?: string;
    geminiBaseUrl?: string;
    // OpenRouter configuration
    openrouterApiKey?: string;
    // Ollama configuration
    ollamaModel?: string;
    ollamaHost?: string;
    ollamaDimension?: number;
    // Vector database configuration
    milvusAddress?: string; // Optional, can be auto-resolved from token
    milvusToken?: string;
    collectionNameOverride?: string;
}

// Legacy format (v1) - for backward compatibility
export interface CodebaseSnapshotV1 {
    indexedCodebases: string[];
    indexingCodebases: string[] | Record<string, number>;  // Array (legacy) or Map of codebase path to progress percentage
    lastUpdated: string;
}

// New format (v2) - structured with codebase information

export type RequestSplitterType = 'ast' | 'langchain';

// Request-level indexing options stored with a codebase's snapshot entry.
export interface CodebaseIndexOptions {
    requestSplitter?: RequestSplitterType;
    requestCustomExtensions?: string[];
    requestIgnorePatterns?: string[];
}

// Base interface for common fields
interface CodebaseInfoBase extends CodebaseIndexOptions {
    lastUpdated: string;
}

// Indexing state - when indexing is in progress
export interface CodebaseInfoIndexing extends CodebaseInfoBase {
    status: 'indexing';
    indexingPercentage: number;  // Current progress percentage
}

// Indexed state - when indexing completed successfully
export interface CodebaseInfoIndexed extends CodebaseInfoBase {
    status: 'indexed';
    indexedFiles: number;        // Number of files indexed
    totalChunks: number;         // Total number of chunks generated
    indexStatus: 'completed' | 'limit_reached';  // Status from indexing result
}

// Index failed state - when indexing failed
export interface CodebaseInfoIndexFailed extends CodebaseInfoBase {
    status: 'indexfailed';
    errorMessage: string;        // Error message from the failure
    lastAttemptedPercentage?: number;  // Progress when failure occurred
}

// Union type for all codebase information states
export type CodebaseInfo = CodebaseInfoIndexing | CodebaseInfoIndexed | CodebaseInfoIndexFailed;

export interface CodebaseSnapshotV2 {
    formatVersion: 'v2';
    codebases: Record<string, CodebaseInfo>;  // codebasePath -> CodebaseInfo
    lastUpdated: string;
}

// Union type for all supported formats
export type CodebaseSnapshot = CodebaseSnapshotV1 | CodebaseSnapshotV2;

// Helper function to get default model for each provider
export function getDefaultModelForProvider(provider: string): string {
    switch (provider) {
        case 'OpenAI':
            return 'text-embedding-3-small';
        case 'VoyageAI':
            return 'voyage-code-3';
        case 'Gemini':
            return 'gemini-embedding-001';
        case 'OpenRouter':
            return 'openai/text-embedding-3-small';
        case 'Ollama':
            return 'nomic-embed-text';
        default:
            return 'text-embedding-3-small';
    }
}

// Helper function to get embedding model with provider-specific environment variable priority
export function getEmbeddingModelForProvider(provider: string): string {
    switch (provider) {
        case 'Ollama':
            // For Ollama, prioritize OLLAMA_MODEL over EMBEDDING_MODEL for backward compatibility
            const ollamaModel = envManager.get('OLLAMA_MODEL') || envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 Ollama model selection: OLLAMA_MODEL=${envManager.get('OLLAMA_MODEL') || 'NOT SET'}, EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${ollamaModel}`);
            return ollamaModel;
        case 'OpenAI':
        case 'VoyageAI':
        case 'Gemini':
        case 'OpenRouter':
        default:
            // For all other providers, use EMBEDDING_MODEL or default
            const selectedModel = envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 ${provider} model selection: EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${selectedModel}`);
            return selectedModel;
    }
}

function getPositiveIntegerFromEnv(name: string): number | undefined {
    const rawValue = envManager.get(name);
    if (!rawValue) {
        return undefined;
    }

    const parsedValue = Number(rawValue);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
        return parsedValue;
    }

    console.warn(`[DEBUG] ⚠️  Ignoring invalid ${name}: ${rawValue}. Expected a positive integer.`);
    return undefined;
}

function getCliOption(args: string[], name: string): string | undefined {
    const flag = `--${name}`;
    const flagWithEquals = `${flag}=`;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === flag) {
            return args[i + 1];
        }
        if (arg.startsWith(flagWithEquals)) {
            return arg.substring(flagWithEquals.length);
        }
    }

    return undefined;
}

function getTransport(args: string[]): 'stdio' | 'http' {
    const rawTransport = getCliOption(args, 'transport') || envManager.get('MCP_TRANSPORT') || 'stdio';
    const transport = rawTransport.trim().toLowerCase();

    if (transport === 'stdio' || transport === 'http') {
        return transport;
    }

    throw new Error(`Invalid MCP transport '${rawTransport}'. Expected 'stdio' or 'http'.`);
}

function getHttpPort(args: string[]): number {
    const rawPort = getCliOption(args, 'port') || envManager.get('MCP_HTTP_PORT') || '3000';
    const port = Number.parseInt(rawPort, 10);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid MCP HTTP port '${rawPort}'. Expected an integer from 1 to 65535.`);
    }

    return port;
}

function getHttpPath(args: string[]): string {
    const rawPath = getCliOption(args, 'path') || envManager.get('MCP_HTTP_PATH') || '/mcp';
    const httpPath = rawPath.trim();

    if (!httpPath.startsWith('/')) {
        throw new Error(`Invalid MCP HTTP path '${rawPath}'. Expected a path starting with '/'.`);
    }
    if (httpPath.length > 1 && httpPath.endsWith('/')) {
        return httpPath.slice(0, -1);
    }

    return httpPath;
}

export function createMcpConfig(args: string[] = process.argv.slice(2)): ContextMcpConfig {
    // Debug: Print all environment variables related to Context
    console.log(`[DEBUG] 🔍 Environment Variables Debug:`);
    console.log(`[DEBUG]   EMBEDDING_PROVIDER: ${envManager.get('EMBEDDING_PROVIDER') || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_MODEL: ${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_DIMENSION: ${envManager.get('EMBEDDING_DIMENSION') || 'NOT SET'}`);
    console.log(`[DEBUG]   OLLAMA_MODEL: ${envManager.get('OLLAMA_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   GEMINI_API_KEY: ${envManager.get('GEMINI_API_KEY') ? 'SET (length: ' + envManager.get('GEMINI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   OPENAI_API_KEY: ${envManager.get('OPENAI_API_KEY') ? 'SET (length: ' + envManager.get('OPENAI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   MILVUS_ADDRESS: ${envManager.get('MILVUS_ADDRESS') || 'NOT SET'}`);
    console.log(`[DEBUG]   CODE_CHUNKS_COLLECTION_NAME_OVERRIDE: ${envManager.get('CODE_CHUNKS_COLLECTION_NAME_OVERRIDE') || 'NOT SET'}`);
    console.log(`[DEBUG]   NODE_ENV: ${envManager.get('NODE_ENV') || 'NOT SET'}`);

    const config: ContextMcpConfig = {
        name: envManager.get('MCP_SERVER_NAME') || "Context MCP Server",
        version: envManager.get('MCP_SERVER_VERSION') || "1.0.0",
        transport: getTransport(args),
        httpHost: getCliOption(args, 'host') || envManager.get('MCP_HTTP_HOST') || '127.0.0.1',
        httpPort: getHttpPort(args),
        httpPath: getHttpPath(args),
        // Embedding provider configuration
        embeddingProvider: (envManager.get('EMBEDDING_PROVIDER') as 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama' | 'OpenRouter') || 'OpenAI',
        embeddingModel: getEmbeddingModelForProvider(envManager.get('EMBEDDING_PROVIDER') || 'OpenAI'),
        // Provider-specific API keys
        openaiApiKey: envManager.get('OPENAI_API_KEY'),
        openaiBaseUrl: envManager.get('OPENAI_BASE_URL'),
        voyageaiApiKey: envManager.get('VOYAGEAI_API_KEY'),
        geminiApiKey: envManager.get('GEMINI_API_KEY'),
        geminiBaseUrl: envManager.get('GEMINI_BASE_URL'),
        // OpenRouter configuration
        openrouterApiKey: envManager.get('OPENROUTER_API_KEY'),
        // Ollama configuration
        ollamaModel: envManager.get('OLLAMA_MODEL'),
        ollamaHost: envManager.get('OLLAMA_HOST'),
        ollamaDimension: getPositiveIntegerFromEnv('EMBEDDING_DIMENSION'),
        // Vector database configuration - address can be auto-resolved from token
        milvusAddress: envManager.get('MILVUS_ADDRESS'), // Optional, can be resolved from token
        milvusToken: envManager.get('MILVUS_TOKEN'),
        collectionNameOverride: envManager.get('CODE_CHUNKS_COLLECTION_NAME_OVERRIDE')
    };

    return config;
}

export function logConfigurationSummary(config: ContextMcpConfig): void {
    // Log configuration summary before starting server
    console.log(`[MCP] 🚀 Starting Context MCP Server`);
    console.log(`[MCP] Configuration Summary:`);
    console.log(`[MCP]   Server: ${config.name} v${config.version}`);
    console.log(`[MCP]   Transport: ${config.transport}`);
    if (config.transport === 'http') {
        console.log(`[MCP]   HTTP URL: http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
    }
    console.log(`[MCP]   Embedding Provider: ${config.embeddingProvider}`);
    console.log(`[MCP]   Embedding Model: ${config.embeddingModel}`);
    console.log(`[MCP]   Milvus Address: ${config.milvusAddress || (config.milvusToken ? '[Auto-resolve from token]' : '[Not configured]')}`);
    if (config.collectionNameOverride) {
        console.log(`[MCP]   Collection Name Override: ✅ Configured`);
    }

    // Log provider-specific configuration without exposing sensitive data
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[MCP]   OpenAI API Key: ${config.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.openaiBaseUrl) {
                console.log(`[MCP]   OpenAI Base URL: ${config.openaiBaseUrl}`);
            }
            break;
        case 'VoyageAI':
            console.log(`[MCP]   VoyageAI API Key: ${config.voyageaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[MCP]   Gemini API Key: ${config.geminiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.geminiBaseUrl) {
                console.log(`[MCP]   Gemini Base URL: ${config.geminiBaseUrl}`);
            }
            break;
        case 'OpenRouter':
            console.log(`[MCP]   OpenRouter API Key: ${config.openrouterApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Ollama':
            console.log(`[MCP]   Ollama Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}`);
            console.log(`[MCP]   Ollama Model: ${config.embeddingModel}`);
            if (config.ollamaDimension) {
                console.log(`[MCP]   Ollama Embedding Dimension: ${config.ollamaDimension}`);
            }
            break;
    }

    console.log(`[MCP] 🔧 Initializing server components...`);
}

export function showHelpMessage(): void {
    console.log(`
Context MCP Server

Usage: npx @zilliz/claude-context-mcp@latest [options]

Options:
  --help, -h                          Show this help message
  --transport stdio|http               Transport to use (default: stdio)
  --host <host>                        HTTP host when --transport http (default: 127.0.0.1)
  --port <port>                        HTTP port when --transport http (default: 3000)
  --path <path>                        HTTP MCP path when --transport http (default: /mcp)

Environment Variables:
  MCP_SERVER_NAME         Server name
  MCP_SERVER_VERSION      Server version
  MCP_TRANSPORT           Transport to use: stdio or http (default: stdio)
  MCP_HTTP_HOST           HTTP host when MCP_TRANSPORT=http (default: 127.0.0.1)
  MCP_HTTP_PORT           HTTP port when MCP_TRANSPORT=http (default: 3000)
  MCP_HTTP_PATH           HTTP MCP path when MCP_TRANSPORT=http (default: /mcp)
  
  Embedding Provider Configuration:
  EMBEDDING_PROVIDER      Embedding provider: OpenAI, VoyageAI, Gemini, Ollama, OpenRouter (default: OpenAI)
  EMBEDDING_MODEL         Embedding model name (works for all providers)
  EMBEDDING_DIMENSION     Optional embedding dimension override for Ollama
  
  Provider-specific API Keys:
  OPENAI_API_KEY          OpenAI API key (required for OpenAI provider)
  OPENAI_BASE_URL         OpenAI API base URL (optional, for custom endpoints)
  VOYAGEAI_API_KEY        VoyageAI API key (required for VoyageAI provider)
  GEMINI_API_KEY          Google AI API key (required for Gemini provider)
  GEMINI_BASE_URL         Gemini API base URL (optional, for custom endpoints)
  OPENROUTER_API_KEY      OpenRouter API key (required for OpenRouter provider)

  Ollama Configuration:
  OLLAMA_HOST             Ollama server host (default: http://127.0.0.1:11434)
  OLLAMA_MODEL            Ollama model name (alternative to EMBEDDING_MODEL for Ollama)
  
  Vector Database Configuration:
  MILVUS_ADDRESS          Milvus address (optional, can be auto-resolved from token)
  MILVUS_TOKEN            Milvus token (optional, used for authentication and address resolution)
  CODE_CHUNKS_COLLECTION_NAME_OVERRIDE
                          Optional readable prefix for collection names.
                          Uses code_chunks_<override>_<pathHash> (or hybrid_...)
                          after sanitization (letters/digits/underscore, 255 chars max).
                          The per-codebase pathHash is preserved so multiple
                          codebases stay distinct under the same override.

  MCP Sync Configuration:
  CLAUDE_CONTEXT_BACKGROUND_SYNC
                          Enable/disable startup + periodic background sync
                          for indexed codebases (default: true). Set to false
                          to disable polling while keeping trigger-based sync.
  CLAUDE_CONTEXT_SYNC_INTERVAL_MS
                          Background sync interval in milliseconds when enabled
                          (default: 300000).

  Sync Trigger Watcher:
  CLAUDE_CONTEXT_TRIGGER_WATCHER
                          Enable/disable the ~/.context/.sync-trigger filesystem
                          watcher (default: true). When enabled, touching the
                          trigger file kicks off an immediate, debounced re-index.
                          Triggered syncs share the same global cross-process
                          lock as background sync, so multi-instance setups stay
                          coordinated. Set to false to disable filesystem
                          watching entirely (read-only / sandboxed environments).

Examples:
  # Start MCP server with OpenAI (default) and explicit Milvus address
  OPENAI_API_KEY=sk-xxx MILVUS_ADDRESS=localhost:19530 npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with OpenAI and specific model
  OPENAI_API_KEY=sk-xxx EMBEDDING_MODEL=text-embedding-3-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with VoyageAI and specific model
  EMBEDDING_PROVIDER=VoyageAI VOYAGEAI_API_KEY=pa-xxx EMBEDDING_MODEL=voyage-3-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Gemini and specific model
  EMBEDDING_PROVIDER=Gemini GEMINI_API_KEY=xxx EMBEDDING_MODEL=gemini-embedding-001 MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Ollama and specific model (using OLLAMA_MODEL)
  EMBEDDING_PROVIDER=Ollama OLLAMA_MODEL=mxbai-embed-large MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest
  
  # Start MCP server with Ollama and specific model (using EMBEDDING_MODEL)
  EMBEDDING_PROVIDER=Ollama EMBEDDING_MODEL=nomic-embed-text MILVUS_TOKEN=your-token npx @zilliz/claude-context-mcp@latest

  # Start MCP server with a human-readable collection name override
  OPENAI_API_KEY=sk-xxx MILVUS_TOKEN=your-token CODE_CHUNKS_COLLECTION_NAME_OVERRIDE=my_project npx @zilliz/claude-context-mcp@latest

  # Start MCP server with background sync enabled every minute
  OPENAI_API_KEY=sk-xxx MILVUS_TOKEN=your-token CLAUDE_CONTEXT_BACKGROUND_SYNC=true CLAUDE_CONTEXT_SYNC_INTERVAL_MS=60000 npx @zilliz/claude-context-mcp@latest
        `);
}
