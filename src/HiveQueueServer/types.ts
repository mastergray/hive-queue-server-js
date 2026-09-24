// Type dependencies:
import type { HiveQueueEnv } from "hive-queue";                                          // Environment type the queue accepts; never a function
import type HiveQueueServerRequest from "../HiveQueueServerRequest/HiveQueueServerRequest.js";   // Passed to onError when a request is known

/**
 *
 * Type Declarations
 *
 */

// TYPE :: STRING -> BOOLEAN
// Predicate form of a CORS origin: called with the request's Origin header value.
export type HiveQueueServerOriginPredicate = (origin: string) => boolean;

// INTERFACE :: {origin:STRING|[STRING]|(STRING -> BOOLEAN)|"*", methods:[STRING]?, allowedHeaders:[STRING]?, exposedHeaders:[STRING]?, credentials:BOOLEAN?, maxAge:NUMBER?}
// CORS configuration; absent from the server config means CORS is off.
export interface HiveQueueServerCorsConfig {
    readonly origin: string | string[] | HiveQueueServerOriginPredicate | "*";   // Allowed origin(s)
    readonly methods?: string[];                                                 // Allowed methods on preflight; defaults to all verbs
    readonly allowedHeaders?: string[];                                          // Allowed request headers; defaults to reflecting the preflight
    readonly exposedHeaders?: string[];                                          // Response headers the browser may read
    readonly credentials?: boolean;                                              // Adds Access-Control-Allow-Credentials
    readonly maxAge?: number;                                                    // Preflight cache seconds
}

// TYPE :: ARRAY<STRING, [STRING]>
// A Content-Security-Policy given as directive names to source lists, serialized by the server.
export type HiveQueueServerCspDirectives = Record<string, string[]>;

// TYPE :: BOOLEAN|STRING|hiveQueueServerCspDirectives
// One security header's setting: true for the default value, false to omit, a string for an explicit value, or (CSP only) a directive map.
export type HiveQueueServerHeaderSetting = boolean | string | HiveQueueServerCspDirectives;

// TYPE :: ARRAY<STRING, hiveQueueServerHeaderSetting>
// Security headers configuration keyed by header name; false in place of the whole map disables the set.
export type HiveQueueServerHeadersConfig = Record<string, HiveQueueServerHeaderSetting>;

// TYPE :: UNKNOWN -> PROMISE(VOID)|VOID
// Callback invoked once the server has stopped, with the halt value.
export type HiveQueueServerOnHalt = (value: unknown) => Promise<void> | void;

// TYPE :: UNKNOWN, hiveQueueServerRequest? -> VOID
// Reporter for failures that have no client to answer; the request is passed when one is known.
export type HiveQueueServerOnError = (error: unknown, request?: HiveQueueServerRequest) => void;

// INTERFACE :: {port:NUMBER?, host:STRING?, concurrency:NUMBER?, timeout:NUMBER?, maxPending:NUMBER?, maxBodySize:NUMBER?, drainTimeout:NUMBER?, retryAfter:NUMBER?, recover:BOOLEAN?, cors:hiveQueueServerCorsConfig?, headers:hiveQueueServerHeadersConfig|FALSE?, env:hiveQueueEnv<Env>?, onHalt:hiveQueueServerOnHalt?, onError:hiveQueueServerOnError?}
// Server configuration; every field is optional and the constructor supplies the documented default.
// NOTE: <Env> is the queue's shared environment type (documented on the class).
export interface HiveQueueServerConfig<Env = unknown> {
    readonly port?: number;                                        // Default 3000; 0 means OS-assigned
    readonly host?: string;                                        // Default undefined; all interfaces
    readonly concurrency?: number;                                 // Default 32; passed to the queue
    readonly timeout?: number;                                     // Default 30000ms; per-request deadline
    readonly maxPending?: number;                                  // Default undefined; unbounded admission
    readonly maxBodySize?: number;                                 // Default 1048576 bytes
    readonly drainTimeout?: number;                                // Default 10000ms
    readonly retryAfter?: number;                                  // Default 1 second; sent on 503
    readonly recover?: boolean;                                    // Default true
    readonly cors?: HiveQueueServerCorsConfig;                     // Default undefined; CORS off
    readonly headers?: HiveQueueServerHeadersConfig | false;       // Default undefined; all defaults on
    readonly env?: HiveQueueEnv<Env>;                              // Passed to the queue; cannot be a function
    readonly onHalt?: HiveQueueServerOnHalt;                       // Invoked when the server has stopped
    readonly onError?: HiveQueueServerOnError;                     // Default: log to standard error
}

/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is an integer in 0..65535
export function isHiveQueueServerPort(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is an integer of at least one; the rule for timeout, concurrency, maxPending, and drainTimeout
export function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is an integer of at least zero; the rule for maxBodySize and retryAfter
export function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a list of strings
export function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((s) => typeof s === "string");
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a HiveQueueServerCorsConfig of the right shape; the wildcard-with-credentials rule is checked by the constructor, which names it
export function isHiveQueueServerCorsConfig(value: unknown): value is HiveQueueServerCorsConfig {
    if (typeof value !== "object" || value === null) return false;
    const cors = value as HiveQueueServerCorsConfig;
    const originIsValid = typeof cors.origin === "string" || typeof cors.origin === "function" || isStringList(cors.origin);
    return originIsValid
        && (cors.methods === undefined || isStringList(cors.methods))
        && (cors.allowedHeaders === undefined || isStringList(cors.allowedHeaders))
        && (cors.exposedHeaders === undefined || isStringList(cors.exposedHeaders))
        && (cors.credentials === undefined || typeof cors.credentials === "boolean")
        && (cors.maxAge === undefined || isNonNegativeInteger(cors.maxAge));
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a map from directive names to lists of strings
export function isHiveQueueServerCspDirectives(value: unknown): value is HiveQueueServerCspDirectives {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        && Object.values(value as Record<string, unknown>).every(isStringList);
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a boolean or a string; the setting forms every header accepts (CSP additionally accepts a directive map)
export function isHiveQueueServerHeaderSetting(value: unknown): value is boolean | string {
    return typeof value === "boolean" || typeof value === "string";
}

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a function usable as onHalt or onError
export function isHiveQueueServerCallback(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === "function";
}
