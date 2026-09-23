// Dependencies:
import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { HiveQueueServerError } from "./HiveQueueServerError.js";

// Called once when the response ends:
export type HiveQueueServerResponseOnEnd = () => void;

// Bodies accepted by send:
export type HiveQueueServerResponseBody = string | Uint8Array | Readable;

// Wraps the host response, holding pending status and headers until an ending helper writes them:
// NOTE: Knows nothing about tasks; a handler may pass this object to a worker in task data
export class HiveQueueServerResponse {

    /* Instance Properties */
    readonly raw: ServerResponse;                                // Host response
    responded: boolean;                                          // Whether the response has ended
    private pendingStatus: number;                               // Status written at end
    private pendingHeaders: Map<string, [string, string]>;       // Lower-case name -> [given name, value]
    private onEnd: HiveQueueServerResponseOnEnd;                 // Invoked once at end
    private ended: boolean;                                      // Guards onEnd

    // CONSTRUCTOR \\
    constructor(raw: ServerResponse, onEnd: HiveQueueServerResponseOnEnd) {
        this.raw = raw;
        this.responded = false;
        this.pendingStatus = 200;
        this.pendingHeaders = new Map();
        this.onEnd = onEnd;
        this.ended = false;
    }

    /**
     *
     *  Instance Methods
     *
     */

    // Sets pending status:
    status(code: number): this {
        this.guard();
        this.pendingStatus = code;
        return this;
    }

    // Sets a pending header:
    header(name: string, value: string): this {
        this.guard();
        this.pendingHeaders.set(name.toLowerCase(), [name, value]);
        return this;
    }

    // Serializes value as JSON and ends:
    json(value: unknown): void {
        this.guard();
        const body = JSON.stringify(value);
        this.defaultHeader("Content-Type", "application/json");
        this.finish(body);
    }

    // Sends a string, bytes, or stream and ends:
    send(body: HiveQueueServerResponseBody): void {
        this.guard();
        if (typeof body === "string") {
            this.defaultHeader("Content-Type", "text/plain; charset=utf-8");
            this.finish(body);
        } else if (body instanceof Readable) {
            this.defaultHeader("Content-Type", "application/octet-stream");
            this.finish(body);
        } else {
            this.defaultHeader("Content-Type", "application/octet-stream");
            this.finish(body);
        }
    }

    // Redirects to url with optional status and ends:
    redirect(url: string, status: number = 302): void {
        this.guard();
        this.pendingStatus = status;
        this.header("Location", url);
        this.finish(undefined);
    }

    // Ends with no body:
    end(): void {
        this.guard();
        this.finish(undefined);
    }

    /**
     *
     *  Private Methods
     *
     */

    // Rejects any operation after the response has ended:
    private guard(): void {
        if (this.responded) {
            throw HiveQueueServerError.ALREADY_RESPONDED();
        }
    }

    // Sets a header only if not already pending:
    private defaultHeader(name: string, value: string): void {
        if (!this.pendingHeaders.has(name.toLowerCase())) {
            this.pendingHeaders.set(name.toLowerCase(), [name, value]);
        }
    }

    // Writes status, headers, and body to the host response and ends it:
    // NOTE: For HEAD requests the body is suppressed but Content-Length reflects what GET would send
    private finish(body: string | Uint8Array | Readable | undefined): void {

        // Compute Content-Length for buffered bodies unless already set:
        const isStream = body instanceof Readable;
        if (body !== undefined && !isStream) {
            const length = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
            this.defaultHeader("Content-Length", String(length));
        }

        // Mark ended before writing so a throw from the host cannot leave the response reusable:
        this.responded = true;

        // Write head:
        const headers: Record<string, string> = {};
        for (const [name, value] of this.pendingHeaders.values()) {
            headers[name] = value;
        }
        this.raw.writeHead(this.pendingStatus, headers);

        // Write body:
        const isHead = this.raw.req?.method === "HEAD";
        if (body === undefined || isHead) {
            if (isStream) {
                body.destroy();
            }
            this.raw.end();
        } else if (isStream) {
            body.on("error", () => {
                this.raw.destroy();
            });
            body.pipe(this.raw);
        } else {
            this.raw.end(body);
        }

        // Signal end once:
        if (!this.ended) {
            this.ended = true;
            this.onEnd();
        }

    }

}
