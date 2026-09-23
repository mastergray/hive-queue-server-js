// Dependencies:
import type { IncomingMessage } from "node:http";
import type { HiveQueueServerRouteMatch, HiveQueueServerQuery, HiveQueueServerHeaders, HiveQueueServerLocals } from "../interfaces/index.js";
import { HiveQueueServerError } from "./HiveQueueServerError.js";

// Media types readBody knows how to parse:
const JSON_TYPE = "application/json";
const FORM_TYPE = "application/x-www-form-urlencoded";

// Parsed request handed to handlers as task data:
export class HiveQueueServerRequest {

    /* Instance Properties */
    readonly method: string;                    // Upper-cased HTTP method
    readonly path: string;                      // Decoded URL path without query string
    readonly route: string;                     // Matched route pattern
    readonly params: Record<string, string>;    // Bound pattern segments
    readonly query: HiveQueueServerQuery;       // Parsed query string
    readonly headers: HiveQueueServerHeaders;   // Lower-case header names
    body: unknown;                              // Set by readBody; undefined until then
    readonly locals: HiveQueueServerLocals;     // Shared state between stages
    readonly raw: IncomingMessage;              // Host request
    private bodyRead: boolean;                  // Guards a second readBody

    // CONSTRUCTOR \\
    // NOTE: Use the static factory; the constructor takes already-parsed fields
    constructor(fields: {
        method: string,
        path: string,
        route: string,
        params: Record<string, string>,
        query: HiveQueueServerQuery,
        headers: HiveQueueServerHeaders,
        raw: IncomingMessage
    }) {
        this.method = fields.method;
        this.path = fields.path;
        this.route = fields.route;
        this.params = fields.params;
        this.query = fields.query;
        this.headers = fields.headers;
        this.body = undefined;
        this.locals = {};
        this.raw = fields.raw;
        this.bodyRead = false;
    }

    /**
     *
     *  Instance Methods
     *
     */

    // Case-insensitive header lookup:
    header(name: string): string | undefined {
        return this.headers[name.toLowerCase()];
    }

    // Whether the Content-Type media type equals the given type:
    is(type: string): boolean {
        return HiveQueueServerRequest.mediaType(this.header("content-type")) === type.toLowerCase();
    }

    // Reads and parses the body if it is JSON or URL-encoded, enforcing a byte cap:
    // NOTE: Leaves body undefined and the stream unread for any other media type
    async readBody(maxBytes: number): Promise<void> {

        // Read at most once:
        if (this.bodyRead) {
            return;
        }
        this.bodyRead = true;

        // No body to read:
        const declared = this.header("content-length");
        const chunked = (this.header("transfer-encoding") ?? "").toLowerCase().includes("chunked");
        if (!chunked && (declared === undefined || Number(declared) === 0)) {
            return;
        }

        // Only parse the media types we understand; leave the stream for the handler otherwise:
        const type = HiveQueueServerRequest.mediaType(this.header("content-type"));
        if (type !== JSON_TYPE && type !== FORM_TYPE) {
            return;
        }

        // A declared length past the cap is rejected before reading anything:
        if (declared !== undefined && Number(declared) > maxBytes) {
            throw HiveQueueServerError.PAYLOAD_TOO_LARGE();
        }

        // Read with the cap enforced as bytes arrive:
        const text = await HiveQueueServerRequest.readText(this.raw, maxBytes);

        // Parse:
        if (type === JSON_TYPE) {
            try {
                this.body = JSON.parse(text);
            } catch {
                throw HiveQueueServerError.MALFORMED_BODY();
            }
        } else {
            this.body = HiveQueueServerRequest.parseParams(new URLSearchParams(text));
        }

    }

    /**
     *
     *  Static Methods
     *
     */

    // Static Factory Method \\
    // Builds a request from the host request and a route match:
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

    // Splits a request URL into a decoded path and a parsed query:
    // NOTE: Shared with route matching, which needs the decoded path before a request object exists
    // NOTE: Raises MALFORMED_PATH for invalid percent-encoding; the listener answers 400
    static parseUrl(rawUrl: string): { path: string, query: HiveQueueServerQuery } {
        const url = new URL(rawUrl, "http://localhost");
        return {
            path: HiveQueueServerRequest.decode(url.pathname),
            query: HiveQueueServerRequest.parseParams(url.searchParams)
        };
    }

    // Percent-decodes a path, raising MALFORMED_PATH if the encoding is invalid:
    // NOTE: An undecodable path is not a valid request and must not be matched as a literal
    static decode(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            throw HiveQueueServerError.MALFORMED_PATH();
        }
    }

    // Extracts the media type from a Content-Type header value:
    static mediaType(contentType: string | undefined): string | undefined {
        if (contentType === undefined) {
            return undefined;
        }
        return contentType.split(";")[0]?.trim().toLowerCase();
    }

    /**
     *
     *  Private Static Methods
     *
     */

    // Turns URLSearchParams into an object, collecting repeated names into lists:
    private static parseParams(params: URLSearchParams): HiveQueueServerQuery {
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

    // Copies host headers into a plain string map:
    private static flattenHeaders(headers: IncomingMessage["headers"]): HiveQueueServerHeaders {
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

    // Reads the stream as UTF-8 text, pausing it and rejecting once the cap is exceeded:
    // NOTE: Pausing rather than destroying keeps the socket usable for the error response
    private static readText(raw: IncomingMessage, maxBytes: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let received = 0;

            const onData = (chunk: Buffer) => {
                received += chunk.length;
                if (received > maxBytes) {
                    cleanup();
                    raw.pause();
                    reject(HiveQueueServerError.PAYLOAD_TOO_LARGE());
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
            const cleanup = () => {
                raw.off("data", onData);
                raw.off("end", onEnd);
                raw.off("error", onError);
            };

            raw.on("data", onData);
            raw.on("end", onEnd);
            raw.on("error", onError);
        });
    }

}
