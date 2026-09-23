// Dependencies:
import { HiveQueue } from "hive-queue";
import type {
    HiveQueueServerConfig,
    HiveQueueServerCorsConfig,
    HiveQueueServerHeadersConfig
} from "../interfaces/index.js";
import { HiveQueueServerError } from "./HiveQueueServerError.js";
import type { HiveQueueServerRequest } from "./HiveQueueServerRequest.js";

// Error reporter invoked for failures that have no client to answer:
export type HiveQueueServerOnError = (error: unknown, request?: HiveQueueServerRequest) => void;

// Halt callback invoked once the server has stopped:
export type HiveQueueServerOnHalt = (value: unknown) => Promise<void> | void;

// Implements an HTTP server whose requests are tasks on a HiveQueue and whose stages are workers:
export class HiveQueueServer<Env = unknown> {

    /* Instance Properties */
    readonly queue: HiveQueue<Env>;                    // The queue every stage runs on
    readonly port: number;                             // Configured port; 0 means OS-assigned
    readonly host: string | undefined;                 // Configured host
    readonly concurrency: number;                      // In-flight limit passed to the queue
    readonly timeout: number;                          // Per-request deadline in ms
    readonly maxPending: number | undefined;           // Admission limit; undefined means unbounded
    readonly maxBodySize: number;                      // Body cap in bytes
    readonly drainTimeout: number;                     // Close drain cutoff in ms
    readonly retryAfter: number;                       // Seconds sent on 503
    readonly recover: boolean;                         // Whether escaped failures resume the queue
    readonly cors: HiveQueueServerCorsConfig | undefined;         // CORS config; undefined means off
    readonly headers: HiveQueueServerHeadersConfig | false | undefined;  // Security headers config
    onErrorFn: HiveQueueServerOnError;                 // Reporter for failures with no client
    haltFn: HiveQueueServerOnHalt;                     // User's halt callback
    closing: boolean;                                  // Set once shutdown has begun
    launched: boolean;                                 // Set once listening
    admitted: number;                                  // Requests admitted and not yet responded

    // CONSTRUCTOR \\
    constructor(config: HiveQueueServerConfig<Env> = {}) {

        // Validate and resolve config:
        this.port = HiveQueueServer.validatePort(config.port);
        this.host = config.host;
        this.concurrency = HiveQueueServer.validateInteger(config.concurrency, 32, 1, HiveQueueServerError.INVALID_CONCURRENCY);
        this.timeout = HiveQueueServer.validateInteger(config.timeout, 30000, 1, HiveQueueServerError.INVALID_TIMEOUT);
        this.maxPending = config.maxPending === undefined
            ? undefined
            : HiveQueueServer.validateInteger(config.maxPending, 0, 1, HiveQueueServerError.INVALID_MAX_PENDING);
        this.maxBodySize = HiveQueueServer.validateInteger(config.maxBodySize, 1048576, 0, HiveQueueServerError.INVALID_MAX_BODY_SIZE);
        this.drainTimeout = HiveQueueServer.validateInteger(config.drainTimeout, 10000, 1, HiveQueueServerError.INVALID_DRAIN_TIMEOUT);
        this.retryAfter = HiveQueueServer.validateInteger(config.retryAfter, 1, 0, HiveQueueServerError.INVALID_RETRY_AFTER);
        this.recover = config.recover ?? true;
        this.cors = HiveQueueServer.validateCors(config.cors);
        this.headers = HiveQueueServer.validateHeaders(config.headers);
        this.onErrorFn = config.onError ?? HiveQueueServer.defaultOnError;
        this.haltFn = config.onHalt ?? (() => {});

        // Initialize state:
        this.closing = false;
        this.launched = false;
        this.admitted = 0;

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
     *  Instance Methods
     *
     */

    // Sets the callback invoked when the server has stopped:
    onHalt(fn: HiveQueueServerOnHalt): this {
        this.haltFn = fn;
        return this;
    }

    // Sets the reporter for failures that have no client to answer:
    onError(fn: HiveQueueServerOnError): this {
        this.onErrorFn = fn;
        return this;
    }

    /**
     *
     *  Protected Methods
     *
     */

    // Receives the queue's halt value and decides between shutdown and recovery:
    // NOTE: Recovery is specified by the design doc's Halt Handler section and is implemented with lifecycle
    protected async onQueueHalt(value: unknown): Promise<void> {
        if (this.closing) {
            await this.haltFn(value);
            return;
        }
        this.onErrorFn(value);
    }

    /**
     *
     *  Static Methods
     *
     */

    // Static Factory Method \\
    static init<Env = unknown>(config: HiveQueueServerConfig<Env> = {}): HiveQueueServer<Env> {
        return new HiveQueueServer<Env>(config);
    }

    // Default error reporter: logs server errors through their own formatter, everything else raw:
    static defaultOnError(error: unknown): void {
        if (HiveQueueServerError.is(error)) {
            error.log();
        } else {
            console.error(error);
        }
    }

    /**
     *
     *  Private Static Methods
     *
     */

    // Validates a port as an integer in 0-65535, defaulting to 3000:
    private static validatePort(port: number | undefined): number {
        if (port === undefined) {
            return 3000;
        }
        if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
            throw HiveQueueServerError.INVALID_PORT();
        }
        return port;
    }

    // Validates an integer at or above a minimum, defaulting when absent:
    private static validateInteger(
        value: number | undefined,
        fallback: number,
        min: number,
        error: () => HiveQueueServerError
    ): number {
        if (value === undefined) {
            return fallback;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
            throw error();
        }
        return value;
    }

    // Validates CORS config shape and the wildcard-with-credentials combination:
    private static validateCors(cors: HiveQueueServerCorsConfig | undefined): HiveQueueServerCorsConfig | undefined {
        if (cors === undefined) {
            return undefined;
        }
        if (typeof cors !== "object" || cors === null) {
            throw HiveQueueServerError.INVALID_CORS("config must be an object");
        }
        const { origin } = cors;
        const originIsValid = typeof origin === "string"
            || typeof origin === "function"
            || (Array.isArray(origin) && origin.every((o) => typeof o === "string"));
        if (!originIsValid) {
            throw HiveQueueServerError.INVALID_CORS("origin must be a string, list of strings, predicate, or \"*\"");
        }
        if (origin === "*" && cors.credentials === true) {
            throw HiveQueueServerError.INVALID_CORS("origin \"*\" cannot be combined with credentials");
        }
        for (const key of ["methods", "allowedHeaders", "exposedHeaders"] as const) {
            const list = cors[key];
            if (list !== undefined && (!Array.isArray(list) || !list.every((s) => typeof s === "string"))) {
                throw HiveQueueServerError.INVALID_CORS(`${key} must be a list of strings`);
            }
        }
        if (cors.credentials !== undefined && typeof cors.credentials !== "boolean") {
            throw HiveQueueServerError.INVALID_CORS("credentials must be a boolean");
        }
        if (cors.maxAge !== undefined && (!Number.isInteger(cors.maxAge) || cors.maxAge < 0)) {
            throw HiveQueueServerError.INVALID_CORS("maxAge must be a non-negative integer");
        }
        if (origin === "*") {
            console.log("Notice: CORS is enabled for ALL origins!");
        }
        return cors;
    }

    // Validates each security header setting as true, false, a string, or (CSP only) a directive map:
    private static validateHeaders(
        headers: HiveQueueServerHeadersConfig | false | undefined
    ): HiveQueueServerHeadersConfig | false | undefined {
        if (headers === undefined || headers === false) {
            return headers;
        }
        if (typeof headers !== "object" || headers === null) {
            throw HiveQueueServerError.INVALID_HEADERS("*");
        }
        for (const [name, setting] of Object.entries(headers)) {
            if (typeof setting === "boolean" || typeof setting === "string") {
                continue;
            }
            const isCsp = name.toLowerCase() === "content-security-policy";
            const isDirectiveMap = typeof setting === "object"
                && setting !== null
                && !Array.isArray(setting)
                && Object.values(setting).every((v) => Array.isArray(v) && v.every((s) => typeof s === "string"));
            if (!(isCsp && isDirectiveMap)) {
                throw HiveQueueServerError.INVALID_HEADERS(name);
            }
        }
        return headers;
    }

}
