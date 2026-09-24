// Dependencies:
import { HiveQueue } from "hive-queue";                                                   // The queue every stage runs on
import HiveQueueServerError from "../HiveQueueServerError/HiveQueueServerError.js";      // Configuration conditions raised at construction

// Type dependencies:
import {
    isHiveQueueServerCallback,                                                            // Guards onHalt and onError
    isHiveQueueServerCorsConfig,                                                          // Guards the CORS config shape
    isHiveQueueServerCspDirectives,                                                       // Guards a CSP directive map
    isHiveQueueServerHeaderSetting,                                                       // Guards a non-CSP header setting
    isHiveQueueServerPort,                                                                // Guards the port
    isNonNegativeInteger,                                                                 // Guards maxBodySize and retryAfter
    isPositiveInteger,                                                                    // Guards timeout, concurrency, maxPending, drainTimeout
    type HiveQueueServerConfig,                                                           // Configuration accepted by the constructor
    type HiveQueueServerCorsConfig,                                                       // Resolved CORS config
    type HiveQueueServerHeadersConfig,                                                    // Resolved security headers config
    type HiveQueueServerOnError,                                                          // Reporter for failures with no client
    type HiveQueueServerOnHalt,                                                           // Callback invoked once the server has stopped
} from "./types.js";

/**
 *
 * Class
 *
 */

// An HTTP server whose requests are tasks on a HiveQueue and whose stages are workers
// NOTE: <Env> is the queue's shared environment type, readable and replaceable by every handler and worker
export default class HiveQueueServer<Env = unknown> {

    /* Static Fields */
    static readonly DEFAULT_PORT = 3000;                 // Port when config gives none
    static readonly DEFAULT_CONCURRENCY = 32;            // In-flight limit when config gives none
    static readonly DEFAULT_TIMEOUT = 30000;             // Per-request deadline in ms when config gives none
    static readonly DEFAULT_MAX_BODY_SIZE = 1048576;     // Body cap in bytes when config gives none
    static readonly DEFAULT_DRAIN_TIMEOUT = 10000;       // Close drain cutoff in ms when config gives none
    static readonly DEFAULT_RETRY_AFTER = 1;             // Seconds sent on 503 when config gives none

    /* Instance Fields */
    readonly queue: HiveQueue<Env>;                                          // The queue every stage runs on
    readonly port: number;                                                   // Configured port; 0 means OS-assigned
    readonly host: string | undefined;                                       // Configured host
    readonly concurrency: number;                                            // In-flight limit passed to the queue
    readonly timeout: number;                                                // Per-request deadline in ms
    readonly maxPending: number | undefined;                                 // Admission limit; undefined means unbounded
    readonly maxBodySize: number;                                            // Body cap in bytes
    readonly drainTimeout: number;                                           // Close drain cutoff in ms
    readonly retryAfter: number;                                             // Seconds sent on 503
    readonly recover: boolean;                                               // Whether escaped failures resume the queue
    readonly cors: HiveQueueServerCorsConfig | undefined;                    // CORS config; undefined means off
    readonly headers: HiveQueueServerHeadersConfig | false | undefined;      // Security headers config
    private _errorHandler: HiveQueueServerOnError;                           // Reporter for failures with no client
    private _haltHandler: HiveQueueServerOnHalt;                             // User's halt callback
    private _closing: boolean;                                               // Set once shutdown has begun
    private _launched: boolean;                                              // Set once listening
    private _admitted: number;                                               // Requests admitted and not yet responded

    // CONSTRUCTOR :: HiveQueueServerConfig<Env>? -> this
    // Validates config, resolves defaults, and constructs the queue active and concurrent
    // NOTE: Throws the HiveQueueServerError configuration condition named in the design doc's validation table for each rejected field
    constructor(config: HiveQueueServerConfig<Env> = {}) {

        // Validate and resolve scalar config:
        if (config.port !== undefined && !isHiveQueueServerPort(config.port)) throw HiveQueueServerError.INVALID_PORT();
        if (config.concurrency !== undefined && !isPositiveInteger(config.concurrency)) throw HiveQueueServerError.INVALID_CONCURRENCY();
        if (config.timeout !== undefined && !isPositiveInteger(config.timeout)) throw HiveQueueServerError.INVALID_TIMEOUT();
        if (config.maxPending !== undefined && !isPositiveInteger(config.maxPending)) throw HiveQueueServerError.INVALID_MAX_PENDING();
        if (config.maxBodySize !== undefined && !isNonNegativeInteger(config.maxBodySize)) throw HiveQueueServerError.INVALID_MAX_BODY_SIZE();
        if (config.drainTimeout !== undefined && !isPositiveInteger(config.drainTimeout)) throw HiveQueueServerError.INVALID_DRAIN_TIMEOUT();
        if (config.retryAfter !== undefined && !isNonNegativeInteger(config.retryAfter)) throw HiveQueueServerError.INVALID_RETRY_AFTER();
        this.port = config.port ?? HiveQueueServer.DEFAULT_PORT;
        this.host = config.host;
        this.concurrency = config.concurrency ?? HiveQueueServer.DEFAULT_CONCURRENCY;
        this.timeout = config.timeout ?? HiveQueueServer.DEFAULT_TIMEOUT;
        this.maxPending = config.maxPending;
        this.maxBodySize = config.maxBodySize ?? HiveQueueServer.DEFAULT_MAX_BODY_SIZE;
        this.drainTimeout = config.drainTimeout ?? HiveQueueServer.DEFAULT_DRAIN_TIMEOUT;
        this.retryAfter = config.retryAfter ?? HiveQueueServer.DEFAULT_RETRY_AFTER;
        this.recover = config.recover ?? true;

        // Validate CORS: shape by predicate, then the one cross-field rule browsers refuse:
        if (config.cors !== undefined) {
            if (!isHiveQueueServerCorsConfig(config.cors)) throw HiveQueueServerError.INVALID_CORS("origin must be a string, list of strings, predicate, or \"*\"; lists must hold strings; credentials must be a boolean; maxAge must be a non-negative integer");
            if (config.cors.origin === "*" && config.cors.credentials === true) throw HiveQueueServerError.INVALID_CORS("origin \"*\" cannot be combined with credentials");
            if (config.cors.origin === "*") console.log("Notice: CORS is enabled for ALL origins!");
        }
        this.cors = config.cors;

        // Validate security headers: each setting by predicate, naming the offending header:
        if (config.headers !== undefined && config.headers !== false) {
            if (typeof config.headers !== "object" || config.headers === null) throw HiveQueueServerError.INVALID_HEADERS("*");
            for (const [name, setting] of Object.entries(config.headers)) {
                const isCsp = name.toLowerCase() === "content-security-policy";
                if (!isHiveQueueServerHeaderSetting(setting) && !(isCsp && isHiveQueueServerCspDirectives(setting))) {
                    throw HiveQueueServerError.INVALID_HEADERS(name);
                }
            }
        }
        this.headers = config.headers;

        // Callbacks go through their validating setters:
        this._errorHandler = HiveQueueServer.defaultOnError;
        this._haltHandler = () => {};
        if (config.onError !== undefined) this.errorHandler = config.onError;
        if (config.onHalt !== undefined) this.haltHandler = config.onHalt;

        // Initialize state:
        this._closing = false;
        this._launched = false;
        this._admitted = 0;

        // Construct the queue active and concurrent; start is never called:
        // NOTE: The queue's halt handler is the server's own, which decides between shutdown and recovery
        this.queue = HiveQueue.init<Env>({
            isActive: true,
            concurrent: true,
            concurrency: this.concurrency,
            env: config.env,
            onHalt: async (value) => {
                await this.onQueueHalt(value);
            }
        });

    }

    /**
     *
     * Properties
     *
     */

    // GETTER :: VOID -> hiveQueueServerOnError
    // Reporter for failures that have no client to answer
    get errorHandler(): HiveQueueServerOnError {
        return this._errorHandler;
    }

    // SETTER :: hiveQueueServerOnError -> VOID
    // Replaces the error reporter
    // NOTE: Throws HiveQueueServerError INVALID_CALLBACK when value is not a function
    set errorHandler(value: HiveQueueServerOnError) {
        if (!isHiveQueueServerCallback(value)) throw HiveQueueServerError.INVALID_CALLBACK("onError");
        this._errorHandler = value;
    }

    // GETTER :: VOID -> hiveQueueServerOnHalt
    // Callback invoked once the server has stopped
    get haltHandler(): HiveQueueServerOnHalt {
        return this._haltHandler;
    }

    // SETTER :: hiveQueueServerOnHalt -> VOID
    // Replaces the halt callback; the last one set wins
    // NOTE: Throws HiveQueueServerError INVALID_CALLBACK when value is not a function
    set haltHandler(value: HiveQueueServerOnHalt) {
        if (!isHiveQueueServerCallback(value)) throw HiveQueueServerError.INVALID_CALLBACK("onHalt");
        this._haltHandler = value;
    }

    // GETTER :: VOID -> BOOLEAN
    // Whether shutdown has begun
    get closing(): boolean {
        return this._closing;
    }

    // GETTER :: VOID -> BOOLEAN
    // Whether the server is listening
    get launched(): boolean {
        return this._launched;
    }

    // GETTER :: VOID -> NUMBER
    // Requests admitted and not yet responded
    get admitted(): number {
        return this._admitted;
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: hiveQueueServerOnHalt -> this
    // Sets the callback invoked when the server has stopped; chainable
    // NOTE: Throws INVALID_CALLBACK when fn is not a function
    onHalt(fn: HiveQueueServerOnHalt): this {
        this.haltHandler = fn;
        return this;
    }

    // INSTANCE :: hiveQueueServerOnError -> this
    // Sets the reporter for failures that have no client to answer; chainable
    // NOTE: Throws INVALID_CALLBACK when fn is not a function
    onError(fn: HiveQueueServerOnError): this {
        this.errorHandler = fn;
        return this;
    }

    /**
     *
     * Protected Methods
     *
     */

    // PROTECTED :: UNKNOWN -> PROMISE(VOID)
    // Receives the queue's halt value and decides between shutdown and recovery
    // NOTE: Recovery per the design doc's Halt Handler section is implemented with lifecycle; until then an escaped failure is reported
    protected async onQueueHalt(value: unknown): Promise<void> {
        if (this._closing) {
            await this._haltHandler(value);
            return;
        }
        this._errorHandler(value);
    }

    /**
     *
     * Static Methods
     *
     */

    // Static Factory Method :: HiveQueueServerConfig<Env>? -> hiveQueueServer<Env>
    // Mirrors the constructor with an empty config by default
    static init<Env = unknown>(config: HiveQueueServerConfig<Env> = {}): HiveQueueServer<Env> {
        return new HiveQueueServer<Env>(config);
    }

    // STATIC :: UNKNOWN -> VOID
    // Default error reporter: logs server errors through their own formatter, everything else raw
    static defaultOnError(error: unknown): void {
        if (HiveQueueServerError.is(error)) {
            error.log();
        } else {
            console.error(error);
        }
    }

}
