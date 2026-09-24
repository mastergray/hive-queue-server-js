// Dependencies:
import { Readable } from "node:stream";   // A host request is a readable the request class reads the body from

/**
 *
 * Type Declarations
 *
 */

// INTERFACE :: {method:STRING?, url:STRING?, headers:ARRAY<STRING, STRING|[STRING]>?, body:STRING|[STRING]?}
// Options for a scripted host request; the body is emitted as one chunk per string.
export interface HostRequestDoubleOptions {
    method?: string;                                   // HTTP method; default GET
    url?: string;                                      // Request URL with query; default "/"
    headers?: Record<string, string | string[]>;       // Headers as Node exposes them
    body?: string | string[];                          // Body chunks to emit
}

/**
 *
 * Class
 *
 */

// Double of the host request contract: a readable with method, url, and headers that emits scripted body chunks
export default class HostRequestDouble extends Readable {

    /* Instance Fields */
    readonly method: string;                                   // HTTP method
    readonly url: string;                                      // Request URL
    readonly headers: Record<string, string | string[]>;       // Headers as Node exposes them
    private readonly _chunks: string[];                        // Body chunks still to emit

    // CONSTRUCTOR :: HostRequestDoubleOptions? -> this
    // Creates a scripted request
    constructor(options: HostRequestDoubleOptions = {}) {
        super();
        this.method = options.method ?? "GET";
        this.url = options.url ?? "/";
        this.headers = options.headers ?? {};
        this._chunks = options.body === undefined ? [] : Array.isArray(options.body) ? [...options.body] : [options.body];
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: NUMBER -> VOID
    // Emits the next scripted chunk, or ends when none remain
    override _read(_size: number): void {
        const chunk = this._chunks.shift();
        this.push(chunk === undefined ? null : Buffer.from(chunk));
    }

    /**
     *
     * Static Methods
     *
     */

    // Static Factory Method :: HostRequestDoubleOptions? -> hostRequestDouble
    // Mirrors the constructor
    static init(options: HostRequestDoubleOptions = {}): HostRequestDouble {
        return new HostRequestDouble(options);
    }

    // STATIC :: STRING, ARRAY<STRING, STRING>? -> hostRequestDouble
    // A POST with a JSON body and matching Content-Type and Content-Length, plus any extra headers
    static json(body: string, extra: Record<string, string> = {}): HostRequestDouble {
        return new HostRequestDouble({
            method: "POST",
            headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...extra },
            body
        });
    }

}
