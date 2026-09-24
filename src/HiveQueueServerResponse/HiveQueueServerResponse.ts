// Dependencies:
import { Readable } from "node:stream";                                                   // Distinguishes stream bodies for piping
import HiveQueueServerError from "../HiveQueueServerError/HiveQueueServerError.js";      // ALREADY_RESPONDED and INVALID_CALLBACK conditions

// Type dependencies:
import type { ServerResponse } from "node:http";                                          // The host response this class writes to
import {
    isHiveQueueServerResponseOnEnd,                                                       // Guards the on-end callback at construction
    type HiveQueueServerResponseBody,                                                     // Bodies accepted by send()
    type HiveQueueServerResponseOnEnd,                                                    // Callback invoked once when the response ends
} from "./types.js";

/**
 *
 * Class
 *
 */

// Wraps the host response, holding pending status and headers until an ending helper writes them; knows nothing about tasks
export default class HiveQueueServerResponse {

    /* Instance Fields */
    readonly raw: ServerResponse;                                // Host response
    private _responded: boolean;                                 // Whether the response has ended
    private _pendingStatus: number;                              // Status written at end
    private readonly _pendingHeaders: Map<string, [string, string]>;   // Lower-case name -> [given name, value]
    private readonly _onEnd: HiveQueueServerResponseOnEnd;       // Invoked once at end
    private _ended: boolean;                                     // Guards _onEnd

    // CONSTRUCTOR :: serverResponse, hiveQueueServerResponseOnEnd -> this
    // Wraps a host response with the callback to invoke when the response ends
    // NOTE: Throws HiveQueueServerError INVALID_CALLBACK when onEnd is not a function
    constructor(raw: ServerResponse, onEnd: HiveQueueServerResponseOnEnd) {
        if (!isHiveQueueServerResponseOnEnd(onEnd)) throw HiveQueueServerError.INVALID_CALLBACK("onEnd");
        this.raw = raw;
        this._responded = false;
        this._pendingStatus = 200;
        this._pendingHeaders = new Map();
        this._onEnd = onEnd;
        this._ended = false;
    }

    /**
     *
     * Properties
     *
     */

    // GETTER :: VOID -> BOOLEAN
    // Whether the response has ended
    get responded(): boolean {
        return this._responded;
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: NUMBER -> this
    // Sets the pending status
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    status(code: number): this {
        this.guard();
        this._pendingStatus = code;
        return this;
    }

    // INSTANCE :: STRING, STRING -> this
    // Sets a pending header; names are matched case-insensitively
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    header(name: string, value: string): this {
        this.guard();
        this._pendingHeaders.set(name.toLowerCase(), [name, value]);
        return this;
    }

    // INSTANCE :: UNKNOWN -> VOID
    // Serializes value as JSON, defaults Content-Type to application/json, and ends
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    json(value: unknown): void {
        this.guard();
        this.defaultHeader("Content-Type", "application/json");
        this.finish(JSON.stringify(value));
    }

    // INSTANCE :: hiveQueueServerResponseBody -> VOID
    // Sends text, bytes, or a stream with a defaulted Content-Type, and ends
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    send(body: HiveQueueServerResponseBody): void {
        this.guard();
        const type = typeof body === "string"
            ? "text/plain; charset=utf-8"
            : "application/octet-stream";
        this.defaultHeader("Content-Type", type);
        this.finish(body);
    }

    // INSTANCE :: STRING, NUMBER? -> VOID
    // Sets Location and a redirect status (default 302), and ends with no body
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    redirect(url: string, status: number = 302): void {
        this.guard();
        this._pendingStatus = status;
        this.header("Location", url);
        this.finish(undefined);
    }

    // INSTANCE :: VOID -> VOID
    // Ends with no body
    // NOTE: Throws ALREADY_RESPONDED after the response has ended
    end(): void {
        this.guard();
        this.finish(undefined);
    }

    /**
     *
     * Private Methods
     *
     */

    // PRIVATE :: VOID -> VOID
    // Rejects any operation after the response has ended
    // NOTE: Throws ALREADY_RESPONDED
    private guard(): void {
        if (this._responded) throw HiveQueueServerError.ALREADY_RESPONDED();
    }

    // PRIVATE :: STRING, STRING -> VOID
    // Sets a header only if not already pending
    private defaultHeader(name: string, value: string): void {
        if (!this._pendingHeaders.has(name.toLowerCase())) {
            this._pendingHeaders.set(name.toLowerCase(), [name, value]);
        }
    }

    // PRIVATE :: hiveQueueServerResponseBody? -> VOID
    // Writes status, headers, and body to the host response, ends it, and signals onEnd once
    // NOTE: For HEAD requests the body is suppressed but Content-Length reflects what GET would send
    // NOTE: A stream error destroys the host response; it cannot be reported once headers are sent
    private finish(body: HiveQueueServerResponseBody | undefined): void {

        // Compute Content-Length for buffered bodies unless already set:
        const isStream = body instanceof Readable;
        if (body !== undefined && !isStream) {
            const length = typeof body === "string"
                ? Buffer.byteLength(body)
                : body.byteLength;
            this.defaultHeader("Content-Length", String(length));
        }

        // Mark ended before writing so a throw from the host cannot leave the response reusable:
        this._responded = true;

        // Write head:
        const headers: Record<string, string> = {};
        for (const [name, value] of this._pendingHeaders.values()) {
            headers[name] = value;
        }
        this.raw.writeHead(this._pendingStatus, headers);

        // Write body:
        const isHead = this.raw.req?.method === "HEAD";
        if (body === undefined || isHead) {
            if (isStream) body.destroy();
            this.raw.end();
        } else if (isStream) {
            body.on("error", () => this.raw.destroy());
            body.pipe(this.raw);
        } else {
            this.raw.end(body);
        }

        // Signal end once:
        if (!this._ended) {
            this._ended = true;
            this._onEnd();
        }

    }

}
