// Dependencies:
import { Writable } from "node:stream";   // A host response is a writable the response class pipes into

/**
 *
 * Class
 *
 */

// Double of the host response contract: a writable that records status, headers, body, and end/destroy calls
export default class HostResponseDouble extends Writable {

    /* Instance Fields */
    status: number;                              // Status passed to writeHead
    headers: Record<string, string>;             // Headers passed to writeHead
    endedCount: number;                          // Times end() was called
    destroyedCount: number;                      // Times destroy() was called
    readonly req: { method: string };            // The request this response answers, as Node exposes it
    private readonly _chunks: Buffer[];          // Body chunks written

    // CONSTRUCTOR :: STRING? -> this
    // Creates a recording response for a request of the given method (default GET)
    constructor(method = "GET") {
        super();
        this.status = 0;
        this.headers = {};
        this.endedCount = 0;
        this.destroyedCount = 0;
        this.req = { method };
        this._chunks = [];
    }

    /**
     *
     * Properties
     *
     */

    // GETTER :: VOID -> STRING
    // Everything written, as UTF-8 text
    get body(): string {
        return Buffer.concat(this._chunks).toString();
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: NUMBER, ARRAY<STRING, STRING> -> this
    // Records the status and headers as Node's writeHead would
    writeHead(status: number, headers: Record<string, string>): this {
        this.status = status;
        this.headers = headers;
        return this;
    }

    // INSTANCE :: buffer, STRING, (VOID -> VOID) -> VOID
    // Records a written chunk
    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
        this._chunks.push(Buffer.from(chunk));
        callback();
    }

    // INSTANCE :: [UNKNOWN] -> this
    // Counts the end call and ends the writable
    override end(...args: unknown[]): this {
        this.endedCount++;
        return super.end(...(args as [])) as this;
    }

    // INSTANCE :: error? -> this
    // Counts the destroy call and destroys the writable
    override destroy(error?: Error): this {
        this.destroyedCount++;
        return super.destroy(error);
    }

}
