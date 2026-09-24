/**
 *
 * Type Declarations
 *
 */

// TYPE :: {kind:"literal", value:STRING} | {kind:"param", name:STRING}
// One parsed non-wildcard pattern segment: a literal that must equal the path segment, or a parameter that binds it.
export type HiveQueueServerRouteSegment =
    | { readonly kind: "literal"; readonly value: string }   // Must equal the request segment exactly
    | { readonly kind: "param"; readonly name: string };     // Binds the request segment under name

// INTERFACE :: {route:STRING, params:ARRAY<STRING, STRING>}
// Result of matching a request path against a route pattern.
export interface HiveQueueServerRouteMatch {
    readonly route: string;                            // The matched pattern, e.g. "/users/:id"
    readonly params: Record<string, string>;           // Bound segments; "*" holds a wildcard remainder
}

// INTERFACE :: {method:STRING, route:hiveQueueServerRoute}
// Anything with a method and a parsed route, selectable from a route table.
// NOTE: The route type is structural here to avoid a circular import; the class satisfies it.
export interface HiveQueueServerRoutable {
    readonly method: string;                                              // Upper-cased HTTP method
    readonly route: { match(path: string): Record<string, string> | undefined };   // Parsed pattern with exact matching
}

// INTERFACE :: {entry:T, params:ARRAY<STRING, STRING>}
// The selected route table entry and the params its pattern bound.
// NOTE: <T> is the routable entry type of the table searched.
export interface HiveQueueServerRouteSelection<T extends HiveQueueServerRoutable> {
    readonly entry: T;                                 // The first matching entry in registration order
    readonly params: Record<string, string>;           // Params bound by the entry's pattern
}

/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a valid route pattern: "/"-rooted, no empty segments, ":" segments named, "*" only as the whole last segment
export function isHiveQueueServerRoutePattern(value: unknown): value is string {
    if (typeof value !== "string" || !value.startsWith("/")) {
        return false;
    }
    if (value === "/") {
        return true;
    }
    const parts = value.slice(1).split("/");
    return parts.every((part, i) => {
        if (part === "") return false;
        if (part === "*") return i === parts.length - 1;
        if (part.includes("*")) return false;
        if (part.startsWith(":")) return part.length > 1;
        return true;
    });
}
