// Dependencies:
import HiveQueueServerHTTPError from "../HiveQueueServerHTTPError/HiveQueueServerHTTPError.js";   // PAYLOAD_TOO_LARGE, MALFORMED_BODY, and MALFORMED_PATH conditions

// Type dependencies:
import type { IncomingMessage } from "node:http";                                                 // Host request read for the body
import type { HiveQueueServerRouteMatch } from "../HiveQueueServerRoute/types.js";                 // Route match init() takes
import type {
    HiveQueueServerHeaders,                                                                       // Lower-case header map
    HiveQueueServerParsedUrl,                                                                     // Result of parseUrl()
    HiveQueueServerQuery,                                                                         // Parsed query object
    HiveQueueServerRequestFields,                                                                 // Parsed fields the constructor stores
} from "./types.js";

/**
 *
 * Class
 *
 */

// Parsed request handed to handlers as task data, with body reading for the parser stage
export default class HiveQueueServerRequest {

    /* Static Fields */
    static readonly JSON_TYPE = "application/json";                    // Media type parsed as JSON
    static readonly FORM_TYPE = "application/x-www-form-urlencoded";   // Media type parsed as a form

    /* Instance Fields */
    readonly method: string;                       // Upper-cased HTTP method
    readonly path: string;                         // Decoded URL path without query string
    readonly route: string;                        // Matched route pattern
    readonly params: Record<string, string>;       // Bound pattern segments
    readonly query: HiveQueueServerQuery;          // Parsed query string
    readonly headers: HiveQueueServerHeaders;      // Lower-case header names
    readonly raw: IncomingMessage;                 // Host request
    body: unknown;                                 // Set by readBody(); undefined until then
    private _bodyRead: boolean;                    // Guards a second readBody()

    // CONSTRUCTOR :: HiveQueueServerRequestFields -> this
    // Stores already-parsed fields; init() is the entry point that parses a host request
    constructor(fields: HiveQueueServerRequestFields) {
        this.method = fields.method;
        this.path = fields.path;
        this.route = fields.route;
        this.params = fields.params;
        this.query = fields.query;
        this.headers = fields.headers;
        this.raw = fields.raw;
        this.body = undefined;
        this._bodyRead = false;
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: STRING -> STRING?
    // Case-insensitive header lookup
    header(name: string): string | undefined {
        return this.headers[name.toLowerCase()];
    }

    // INSTANCE :: STRING -> BOOLEAN
    // Whether the Content-Type media type equals the given type, ignoring parameters and case
    is(type: string): boolean {
        return HiveQueueServerRequest.mediaType(this.header("content-type")) === type.toLowerCase();
    }

    // INSTANCE :: NUMBER -> PROMISE(VOID)
    // Reads and parses the body if it is JSON or URL-encoded, enforcing a byte cap; a second call is a no-op
    // NOTE: Leaves body undefined and the stream unread for any other media type or when no body is declared
    // NOTE: Throws HiveQueueServerHTTPError PAYLOAD_TOO_LARGE when the declared or received length exceeds maxBytes
    // NOTE: Throws HiveQueueServerHTTPError MALFORMED_BODY when JSON does not parse
    async readBody(maxBytes: number): Promise<void> {

        // Read at most once:
        if (this._bodyRead) return;
        this._bodyRead = true;

        // No body to read:
        const declared = this.header("content-length");
        const chunked = (this.header("transfer-encoding") ?? "").toLowerCase().includes("chunked");
        if (!chunked && (declared === undefined || Number(declared) === 0)) return;

        // Only parse the media types we understand; leave the stream for the handler otherwise:
        const type = HiveQueueServerRequest.mediaType(this.header("content-type"));
        if (type !== HiveQueueServerRequest.JSON_TYPE && type !== HiveQueueServerRequest.FORM_TYPE) return;

        // A declared length past the cap is rejected before reading anything:
        if (declared !== undefined && Number(declared) > maxBytes) throw HiveQueueServerHTTPError.PAYLOAD_TOO_LARGE();

        // Read with the cap enforced as bytes arrive, then parse:
        const text = await HiveQueueServerRequest.readText(this.raw, maxBytes);
        if (type === HiveQueueServerRequest.JSON_TYPE) {
            try {
                this.body = JSON.parse(text);
            } catch {
                throw HiveQueueServerHTTPError.MALFORMED_BODY();
            }
        } else {
            this.body = HiveQueueServerRequest.parseQuery(new URLSearchParams(text));
        }

    }

    /**
     *
     * Static Methods
     *
     */

    // Static Factory Method :: incomingMessage, hiveQueueServerRouteMatch -> hiveQueueServerRequest
    // Builds a request from the host request and a route match
    // NOTE: Throws HiveQueueServerHTTPError MALFORMED_PATH for invalid percent-encoding in the path
    static init(raw: IncomingMessage, match: HiveQueueServerRouteMatch): HiveQueueServerRequest {
        const { path, query } = HiveQueueServerRequest.parseUrl(raw.url ?? "/");
        return new HiveQueueServerRequest({
            method: (raw.method ?? "GET").toUpperCase(),
            path,
            route: match.route,
            params: match.params,
            query,
            headers: HiveQueueServerRequest.flattenHeaders(raw.headers),
            raw
        });
    }

    // STATIC :: STRING -> hiveQueueServerParsedUrl
    // Splits a request URL into a decoded path and a parsed query; shared with route matching, which runs before a request object exists
    // NOTE: Throws HiveQueueServerHTTPError MALFORMED_PATH for invalid percent-encoding; the listener answers 400
    static parseUrl(rawUrl: string): HiveQueueServerParsedUrl {
        const url = new URL(rawUrl, "http://localhost");
        return {
            path: HiveQueueServerRequest.decode(url.pathname),
            query: HiveQueueServerRequest.parseQuery(url.searchParams)
        };
    }

    // STATIC :: STRING -> STRING
    // Percent-decodes a path
    // NOTE: Throws HiveQueueServerHTTPError MALFORMED_PATH when the encoding is invalid; an undecodable path must not be matched as a literal
    static decode(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            throw HiveQueueServerHTTPError.MALFORMED_PATH();
        }
    }

    // STATIC :: STRING? -> STRING?
    // Extracts the lower-cased media type from a Content-Type header value
    static mediaType(contentType: string | undefined): string | undefined {
        return contentType === undefined
            ? undefined
            : contentType.split(";")[0]?.trim().toLowerCase();
    }

    // STATIC :: urlSearchParams -> hiveQueueServerQuery
    // Turns URLSearchParams into an object, collecting repeated names into lists
    static parseQuery(params: URLSearchParams): HiveQueueServerQuery {
        const result: HiveQueueServerQuery = {};
        for (const [name, value] of params) {
            const existing = result[name];
            if (existing === undefined) {
                result[name] = value;
            } else if (Array.isArray(existing)) {
                existing.push(value);
            } else {
                result[name] = [existing, value];
            }
        }
        return result;
    }

    // STATIC :: ARRAY<STRING, STRING|[STRING]|UNDEFINED> -> hiveQueueServerHeaders
    // Copies host headers into a plain string map, joining multi-valued headers with ", "
    static flattenHeaders(headers: IncomingMessage["headers"]): HiveQueueServerHeaders {
        const result: HiveQueueServerHeaders = {};
        for (const [name, value] of Object.entries(headers)) {
            if (typeof value === "string") {
                result[name] = value;
            } else if (Array.isArray(value)) {
                result[name] = value.join(", ");
            }
        }
        return result;
    }

    // STATIC :: incomingMessage, NUMBER -> PROMISE(STRING)
    // Reads the stream as UTF-8 text, pausing it and rejecting once the cap is exceeded
    // NOTE: Pausing rather than destroying keeps the socket usable for the error response
    // NOTE: Rejects with HiveQueueServerHTTPError PAYLOAD_TOO_LARGE past maxBytes, or with the stream's own error
    static readText(raw: IncomingMessage, maxBytes: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let received = 0;
            const cleanup = () => {
                raw.off("data", onData);
                raw.off("end", onEnd);
                raw.off("error", onError);
            };
            const onData = (chunk: Buffer) => {
                received += chunk.length;
                if (received > maxBytes) {
                    cleanup();
                    raw.pause();
                    reject(HiveQueueServerHTTPError.PAYLOAD_TOO_LARGE());
                    return;
                }
                chunks.push(chunk);
            };
            const onEnd = () => {
                cleanup();
                resolve(Buffer.concat(chunks).toString("utf8"));
            };
            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };
            raw.on("data", onData);
            raw.on("end", onEnd);
            raw.on("error", onError);
        });
    }

}
