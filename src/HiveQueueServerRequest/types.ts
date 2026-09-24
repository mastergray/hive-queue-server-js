// Type dependencies:
import type { IncomingMessage } from "node:http";   // The host request a HiveQueueServerRequest is built from

/**
 *
 * Type Declarations
 *
 */

// TYPE :: ARRAY<STRING, STRING|[STRING]>
// Query string parsed into an object; a name repeated in the query becomes a list.
export type HiveQueueServerQuery = Record<string, string | string[]>;

// TYPE :: ARRAY<STRING, STRING>
// Request headers with lower-case names; a multi-valued header is joined with ", ".
export type HiveQueueServerHeaders = Record<string, string>;

// INTERFACE :: {method:STRING, path:STRING, route:STRING, params:ARRAY<STRING, STRING>, query:hiveQueueServerQuery, headers:hiveQueueServerHeaders, raw:incomingMessage}
// Already-parsed fields the constructor stores; produced by init() from a host request and a route match.
export interface HiveQueueServerRequestFields {
    readonly method: string;                       // Upper-cased HTTP method
    readonly path: string;                         // Decoded URL path without query string
    readonly route: string;                        // Matched route pattern
    readonly params: Record<string, string>;       // Bound pattern segments
    readonly query: HiveQueueServerQuery;          // Parsed query string
    readonly headers: HiveQueueServerHeaders;      // Lower-case header names
    readonly raw: IncomingMessage;                 // Host request
}

// INTERFACE :: {path:STRING, query:hiveQueueServerQuery}
// Result of parseUrl(): the decoded path and the parsed query.
export interface HiveQueueServerParsedUrl {
    readonly path: string;                         // Decoded path without query string
    readonly query: HiveQueueServerQuery;          // Parsed query string
}
