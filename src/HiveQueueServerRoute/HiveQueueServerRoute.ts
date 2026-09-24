// Dependencies:
import HiveQueueServerError from "../HiveQueueServerError/HiveQueueServerError.js";   // INVALID_ROUTE condition

// Type dependencies:
import {
    isHiveQueueServerRoutePattern,                                                     // Guards the pattern at construction
    type HiveQueueServerRoutable,                                                      // Route table entry shape select() searches
    type HiveQueueServerRouteSegment,                                                  // Parsed segment forms
    type HiveQueueServerRouteSelection,                                                // Result of select()
} from "./types.js";

/**
 *
 * Class
 *
 */

// A parsed route pattern that matches request paths and binds parameters; patterns are "/"-rooted with literal, ":name", or trailing "*" segments
export default class HiveQueueServerRoute {

    /* Instance Fields */
    readonly pattern: string;                                    // The pattern as given
    readonly wildcard: boolean;                                  // Whether the pattern ends in "*"
    private readonly _segments: HiveQueueServerRouteSegment[];   // Parsed non-wildcard segments

    // CONSTRUCTOR :: STRING -> this
    // Parses a pattern into segments
    // NOTE: Throws HiveQueueServerError INVALID_ROUTE when the pattern fails isHiveQueueServerRoutePattern()
    constructor(pattern: string) {
        if (!isHiveQueueServerRoutePattern(pattern)) throw HiveQueueServerError.INVALID_ROUTE(String(pattern));
        const parts = pattern === "/"
            ? []
            : pattern.slice(1).split("/");
        this.pattern = pattern;
        this.wildcard = parts[parts.length - 1] === "*";
        const named = this.wildcard
            ? parts.slice(0, -1)
            : parts;
        this._segments = named.map((part) =>
            part.startsWith(":")
                ? { kind: "param", name: part.slice(1) }
                : { kind: "literal", value: part }
        );
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: STRING -> ARRAY<STRING, STRING>?
    // Matches a decoded path exactly, returning bound params or undefined
    // NOTE: A wildcard binds the remainder under "*" and matches zero or more segments
    match(path: string): Record<string, string> | undefined {
        const parts = HiveQueueServerRoute.split(path);
        if (parts.length < this._segments.length) return undefined;
        if (!this.wildcard && parts.length !== this._segments.length) return undefined;
        const params: Record<string, string> = {};
        for (let i = 0; i < this._segments.length; i++) {
            const segment = this._segments[i]!;
            const part = parts[i]!;
            if (segment.kind === "literal") {
                if (segment.value !== part) return undefined;
            } else {
                params[segment.name] = part;
            }
        }
        if (this.wildcard) {
            params["*"] = parts.slice(this._segments.length).join("/");
        }
        return params;
    }

    // INSTANCE :: STRING -> BOOLEAN
    // Matches a decoded path as a prefix, as path-scoped middleware does; a trailing wildcard is implied
    matchPrefix(path: string): boolean {
        const parts = HiveQueueServerRoute.split(path);
        if (parts.length < this._segments.length) return false;
        return this._segments.every((segment, i) => segment.kind !== "literal" || segment.value === parts[i]);
    }

    // INSTANCE :: VOID -> BOOLEAN
    // Whether the pattern is literal-only, with no parameters or wildcard
    isPlain(): boolean {
        return !this.wildcard && this._segments.every((s) => s.kind === "literal");
    }

    /**
     *
     * Static Methods
     *
     */

    // Static Factory Method :: STRING -> hiveQueueServerRoute
    // Mirrors the constructor
    static init(pattern: string): HiveQueueServerRoute {
        return new HiveQueueServerRoute(pattern);
    }

    // STATIC :: [T], STRING, STRING -> hiveQueueServerRouteSelection<T>?
    // Selects the first entry whose method and route match, in registration order; HEAD falls back to GET
    // NOTE: <T> is the routable entry type of the table
    static select<T extends HiveQueueServerRoutable>(
        entries: T[],
        method: string,
        path: string
    ): HiveQueueServerRouteSelection<T> | undefined {
        const byMethod = (wanted: string): HiveQueueServerRouteSelection<T> | undefined => {
            for (const entry of entries) {
                if (entry.method !== wanted) continue;
                const params = entry.route.match(path);
                if (params !== undefined) return { entry, params };
            }
            return undefined;
        };
        const upper = method.toUpperCase();
        return byMethod(upper) ?? (upper === "HEAD"
            ? byMethod("GET")
            : undefined);
    }

    // STATIC :: STRING -> [STRING]
    // Splits a decoded path into segments, ignoring a single trailing slash
    static split(path: string): string[] {
        if (path === "/" || path === "") return [];
        const trimmed = path.endsWith("/")
            ? path.slice(0, -1)
            : path;
        return trimmed.slice(1).split("/");
    }

}
