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
