// Type dependencies:
import type { NonEmptyString } from "../shared.types.js";                  // Type of a message that says something
import {
    isHiveQueueServerErrorConfig,                                          // Guards the construction config
    type HiveQueueServerErrorConfig,                                       // Construction config shape
    type HiveQueueServerErrorLogEntry,                                     // What log() hands a formatter
    type HiveQueueServerErrorLogFormatter,                                 // Formatter accepted by log()
} from "./types.js";

/**
 *
 * Class
 *
 */

// Base typed error for hive-queue-server; every raised error is one of these or HiveQueueServerHTTPError
export default class HiveQueueServerError extends Error {

    /* Static Fields */
    static readonly CODE = {                     // Label-to-code registry; call sites use these, never raw values
        INVALID_CODE: -1,
        INVALID_PORT: 1,
        INVALID_TIMEOUT: 2,
        INVALID_CONCURRENCY: 3,
        INVALID_MAX_PENDING: 4,
        INVALID_MAX_BODY_SIZE: 5,
        INVALID_DRAIN_TIMEOUT: 6,
        INVALID_RETRY_AFTER: 7,
        INVALID_CORS: 8,
        INVALID_HEADERS: 9,
        INVALID_CALLBACK: 10,
        UNKNOWN_ROUTE_WORKER: 11,
        UNKNOWN_MIDDLEWARE_WORKER: 12,
        INVALID_ROUTE: 13,
        INVALID_HANDLER: 14,
        DUPLICATE_ROUTE: 15,
        LAUNCHED: 16,
        SEND_AFTER_DONE: 17,
        DONE_AFTER_DONE: 18,
        ENV_AFTER_DONE: 19,
        ALREADY_RESPONDED: 20,
        UNKNOWN_DELEGATE: 21,
        NOT_FOUND: 22,
        PAYLOAD_TOO_LARGE: 23,
        MALFORMED_BODY: 24,
        SERVICE_UNAVAILABLE: 25,
        GATEWAY_TIMEOUT: 26,
        INTERNAL: 27,
        HTTP: 28,
        MALFORMED_PATH: 29,
        STREAM_FAILED: 30,
        TASK_NOT_COMPLETED: 31,
        INVALID_MESSAGE: 32,
    } as const;

    /* Instance Fields */
    readonly code: number;                       // Stable code drawn from CODE
    readonly data: unknown;                      // Payload of any kind; null when omitted
    declare readonly message: NonEmptyString;    // Inherited from Error, narrowed: always says something

    // CONSTRUCTOR :: HiveQueueServerErrorConfig -> this
    // Creates an error from a config with a registry code, a non-empty message and optional data
    // NOTE: Throws HiveQueueServerError with code -1 (INVALID_CODE) when config is not an object with a numeric code, or the code is not constructible
    // NOTE: Throws HiveQueueServerError with code INVALID_MESSAGE when the message is not a non-empty string
    // NOTE: A thrown error is always a plain HiveQueueServerError, never an instance of the subclass being constructed
    constructor(config: HiveQueueServerErrorConfig) {
        super(isHiveQueueServerErrorConfig(config) ? config.message : "");
        const given = config as unknown;
        const code = typeof given === "object" && given !== null
            ? (given as { code?: unknown }).code
            : undefined;
        if (typeof code !== "number") throw HiveQueueServerError.INVALID_CODE(null);
        if (!isHiveQueueServerErrorConfig(config)) throw HiveQueueServerError.INVALID_MESSAGE((given as { message?: unknown }).message);
        if (code === HiveQueueServerError.CODE.INVALID_CODE || !(Object.values(HiveQueueServerError.CODE) as number[]).includes(code)) {
            throw HiveQueueServerError.INVALID_CODE(code);
        }
        this.name = "HiveQueueServerError";
        this.code = code;
        this.data = config.data ?? null;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     *
     * Properties
     *
     */

    // GETTER :: VOID -> STRING
    // Readable label for code, derived from CODE
    get label(): string {
        return HiveQueueServerError.labelOf(this.code);
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: hiveQueueServerErrorLogFormatter? -> VOID
    // Writes the error to standard error; default output is "{timestamp} Code: {label} ({code}), message: {message}"
    // NOTE: A formatter receives the same entry the default line is built from and its return value is written instead
    log(formatter?: HiveQueueServerErrorLogFormatter): void {
        const entry: HiveQueueServerErrorLogEntry = {
            timestamp: new Date().toISOString(),
            code: this.code,
            label: this.label,
            message: this.message
        };
        console.error(formatter === undefined
            ? `${entry.timestamp} Code: ${entry.label} (${entry.code}), message: ${entry.message}`
            : formatter(entry)
        );
    }

    /**
     *
     * Static Methods
     *
     */

    // Static Factory Method :: HiveQueueServerErrorConfig -> hiveQueueServerError
    // Mirrors the constructor
    // NOTE: Constructs with the receiving class, so a subclass that inherits init returns its own instances
    static init(config: HiveQueueServerErrorConfig): HiveQueueServerError {
        return new this(config);
    }

    // STATIC :: UNKNOWN -> BOOLEAN
    // Narrows an unknown thrown value to HiveQueueServerError (or a subclass)
    static is(value: unknown): value is HiveQueueServerError {
        return value instanceof HiveQueueServerError;
    }

    // STATIC :: UNKNOWN? -> hiveQueueServerError
    // The error raised for a code that cannot be constructed: not a number, the sentinel itself, unregistered, or (HTTP subclass) without a status
    // NOTE: Cannot go through the constructor, which would reject it again; it is assembled directly on the base prototype, so it is a plain base error whatever class was being constructed
    static INVALID_CODE(data?: unknown): HiveQueueServerError {
        return Object.assign(Object.create(HiveQueueServerError.prototype) as HiveQueueServerError, {
            name: "HiveQueueServerError",
            message: "Error Code Is Not A Constructible Registry Code!",
            code: HiveQueueServerError.CODE.INVALID_CODE,
            data: data ?? null
        });
    }

    // STATIC :: UNKNOWN? -> hiveQueueServerError
    // The error raised for a message that is not a non-empty string; the rejected message is carried as data
    static INVALID_MESSAGE(data?: unknown): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_MESSAGE, message: "Error Message Must Be A Non-Empty String!" as NonEmptyString, data });
    }

    // STATIC :: NUMBER -> STRING
    // Returns the CODE label for a code; "INVALID_CODE" for -1 and for any unregistered number
    static labelOf(code: number): string {
        const entry = Object.entries(HiveQueueServerError.CODE).find(([, value]) => value === code);
        return entry === undefined
            ? "INVALID_CODE"
            : entry[0];
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Port is not an integer in 0..65535
    static INVALID_PORT(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_PORT, message: "Port Must Be An Integer Between 0 And 65535!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Timeout is not a positive integer of milliseconds
    static INVALID_TIMEOUT(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_TIMEOUT, message: "Timeout Must Be A Positive Integer Of Milliseconds!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Concurrency is not a positive integer
    static INVALID_CONCURRENCY(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_CONCURRENCY, message: "Concurrency Must Be A Positive Integer!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Max pending is set but not a positive integer
    static INVALID_MAX_PENDING(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_MAX_PENDING, message: "Max Pending Must Be A Positive Integer When Set!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Max body size is not a non-negative integer of bytes
    static INVALID_MAX_BODY_SIZE(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_MAX_BODY_SIZE, message: "Max Body Size Must Be A Non-Negative Integer Of Bytes!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Drain timeout is not a positive integer of milliseconds
    static INVALID_DRAIN_TIMEOUT(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_DRAIN_TIMEOUT, message: "Drain Timeout Must Be A Positive Integer Of Milliseconds!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Retry-After is not a non-negative integer of seconds
    static INVALID_RETRY_AFTER(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_RETRY_AFTER, message: "Retry After Must Be A Non-Negative Integer Of Seconds!" as NonEmptyString });
    }

    // STATIC :: STRING -> hiveQueueServerError
    // CORS config is malformed; the reason names the rule broken
    static INVALID_CORS(reason: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_CORS, message: `Invalid CORS Config: ${reason}` as NonEmptyString });
    }

    // STATIC :: STRING -> hiveQueueServerError
    // A security header setting is not true, false, a string, or (CSP only) a directive map
    static INVALID_HEADERS(name: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_HEADERS, message: `Invalid Value For Security Header "${name}"!` as NonEmptyString });
    }

    // STATIC :: STRING -> hiveQueueServerError
    // A callback config field (onHalt, onError, a response's onEnd) is not a function
    static INVALID_CALLBACK(name: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_CALLBACK, message: `Callback "${name}" Must Be A Function!` as NonEmptyString });
    }


    // STATIC :: STRING -> hiveQueueServerError
    // A route names a worker ID that is not registered at launch
    static UNKNOWN_ROUTE_WORKER(id: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.UNKNOWN_ROUTE_WORKER, message: `No Worker ID "${id}" Registered For Route!` as NonEmptyString });
    }

    // STATIC :: STRING -> hiveQueueServerError
    // A middleware entry names a worker ID that is not registered at launch
    static UNKNOWN_MIDDLEWARE_WORKER(id: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.UNKNOWN_MIDDLEWARE_WORKER, message: `No Worker ID "${id}" Registered For Middleware!` as NonEmptyString });
    }

    // STATIC :: STRING -> hiveQueueServerError
    // A route pattern is malformed
    static INVALID_ROUTE(pattern: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_ROUTE, message: `Invalid Route Pattern "${pattern}"!` as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // A route or middleware handler is neither a worker ID nor a function
    static INVALID_HANDLER(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.INVALID_HANDLER, message: "Handler Must Be A Worker ID Or A Function!" as NonEmptyString });
    }

    // STATIC :: STRING, STRING -> hiveQueueServerError
    // The same method and pattern is bound twice
    static DUPLICATE_ROUTE(method: string, pattern: string): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.DUPLICATE_ROUTE, message: `Route "${method} ${pattern}" Is Already Bound!` as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // Wiring was modified after launch
    static LAUNCHED(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.LAUNCHED, message: "Cannot Modify Server After Launch!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // send was called after the task completed
    static SEND_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.SEND_AFTER_DONE, message: "Cannot Send After Task Is Completed!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // done or halt was called after the task completed
    static DONE_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.DONE_AFTER_DONE, message: "Cannot Complete Task More Than Once!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // getEnv or setEnv was called after the task completed
    static ENV_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.ENV_AFTER_DONE, message: "Cannot Access Env After Task Is Completed!" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // A response helper was called after the response ended
    static ALREADY_RESPONDED(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.ALREADY_RESPONDED, message: "Response Has Already Been Sent!" as NonEmptyString });
    }

    // STATIC :: UNKNOWN? -> hiveQueueServerError
    // A response stream failed after headers were sent; the cause is carried as data
    static STREAM_FAILED(cause?: unknown): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.STREAM_FAILED, message: "Response Stream Failed After Headers Were Sent!" as NonEmptyString, data: cause });
    }

    // STATIC :: VOID -> hiveQueueServerError
    // A handler responded or returned without completing its task before the deadline
    static TASK_NOT_COMPLETED(): HiveQueueServerError {
        return new HiveQueueServerError({ code: HiveQueueServerError.CODE.TASK_NOT_COMPLETED, message: "Handler Did Not Complete Its Task Before The Deadline!" as NonEmptyString });
    }

}
