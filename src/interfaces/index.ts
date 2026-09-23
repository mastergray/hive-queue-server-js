// Dependencies:
import type { HiveQueueEnv } from "hive-queue";

// Result of matching a request path against a route pattern:
export interface HiveQueueServerRouteMatch {
    route: string;                       // The matched pattern, e.g. "/users/:id"
    params: Record<string, string>;      // Bound segments; "*" holds a wildcard remainder
}

// Query string parsed into an object; repeated names become lists:
export type HiveQueueServerQuery = Record<string, string | string[]>;

// Request headers with lower-case names; multi-valued headers are joined:
export type HiveQueueServerHeaders = Record<string, string>;

// Per-request shared state written by middleware for later stages:
export type HiveQueueServerLocals = Record<string, unknown>;

// CORS configuration; absent means CORS is off:
export interface HiveQueueServerCorsConfig {
    origin: string | string[] | ((origin: string) => boolean) | "*";   // Allowed origin(s)
    methods?: string[];                                                 // Allowed methods on preflight; defaults to all verbs
    allowedHeaders?: string[];                                          // Allowed request headers; defaults to reflecting the preflight
    exposedHeaders?: string[];                                          // Response headers the browser may read
    credentials?: boolean;                                              // Adds Access-Control-Allow-Credentials
    maxAge?: number;                                                    // Preflight cache seconds
}

// A Content-Security-Policy given as directives rather than a string:
export type HiveQueueServerCspDirectives = Record<string, string[]>;

// Per-header security header setting: true for the default, false to omit, or an explicit value:
export type HiveQueueServerHeaderSetting = boolean | string | HiveQueueServerCspDirectives;

// Security headers configuration keyed by header name; false disables the whole set:
export type HiveQueueServerHeadersConfig = Record<string, HiveQueueServerHeaderSetting>;

// Server configuration; every field is optional:
export interface HiveQueueServerConfig<Env = unknown> {
    port?: number;                                                      // Default 3000; 0 means OS-assigned
    host?: string;                                                      // Default undefined; all interfaces
    concurrency?: number;                                               // Default 32; passed to the queue
    timeout?: number;                                                   // Default 30000ms; per-request deadline
    maxPending?: number;                                                // Default undefined; unbounded admission
    maxBodySize?: number;                                               // Default 1048576 bytes
    drainTimeout?: number;                                              // Default 10000ms
    retryAfter?: number;                                                // Default 1 second; sent on 503
    recover?: boolean;                                                  // Default true
    cors?: HiveQueueServerCorsConfig;                                   // Default undefined; CORS off
    headers?: HiveQueueServerHeadersConfig | false;                     // Default undefined; all defaults on
    env?: HiveQueueEnv<Env>;                                            // Passed to the queue; cannot be a function
    onHalt?: (value: unknown) => Promise<void> | void;                  // Invoked when the server has stopped
    onError?: (error: unknown, request?: unknown) => void;              // Default: log to standard error
}
