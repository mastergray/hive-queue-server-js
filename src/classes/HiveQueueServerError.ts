export type HiveQueueServerErrorCategory = "configuration" | "wiring" | "lifecycle" | "http" | "internal";
export type HiveQueueServerErrorCode = typeof HiveQueueServerError.Code[keyof typeof HiveQueueServerError.Code];
export type HiveQueueServerErrorLogFormatter = (
    message: string,
    code: HiveQueueServerErrorCode,
    category: HiveQueueServerErrorCategory,
    statusCode: number | undefined
) => string;

// Defines error class for HiveQueueServer:
export class HiveQueueServerError extends Error {

    /* Static Properties */
    static readonly Code = {
        INVALID_PORT: 1000,
        INVALID_TIMEOUT: 1001,
        INVALID_CONCURRENCY: 1002,
        INVALID_MAX_PENDING: 1003,
        INVALID_MAX_BODY_SIZE: 1004,
        INVALID_DRAIN_TIMEOUT: 1005,
        INVALID_RETRY_AFTER: 1006,
        INVALID_CORS: 1007,
        INVALID_HEADERS: 1008,
        UNKNOWN_ROUTE_WORKER: 2000,
        UNKNOWN_MIDDLEWARE_WORKER: 2001,
        INVALID_ROUTE: 2002,
        INVALID_HANDLER: 2003,
        DUPLICATE_ROUTE: 2004,
        LAUNCHED: 2005,
        SEND_AFTER_DONE: 3000,
        DONE_AFTER_DONE: 3001,
        ENV_AFTER_DONE: 3002,
        ALREADY_RESPONDED: 3003,
        UNKNOWN_DELEGATE: 3004,
        NOT_FOUND: 4000,
        PAYLOAD_TOO_LARGE: 4001,
        MALFORMED_BODY: 4002,
        SERVICE_UNAVAILABLE: 4003,
        GATEWAY_TIMEOUT: 4004,
        INTERNAL: 4005,
        HTTP: 4006,
        STREAM_FAILED: 5000,
        TASK_NOT_COMPLETED: 5001
    } as const;

    /* Instance Properties */
    readonly code: HiveQueueServerErrorCode;
    readonly category: HiveQueueServerErrorCategory;
    readonly statusCode: number | undefined;

    // CONSTRUCTOR \\
    constructor(
        code: HiveQueueServerErrorCode,
        category: HiveQueueServerErrorCategory,
        message: string,
        statusCode?: number,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "HiveQueueServerError";
        this.code = code;
        this.category = category;
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     *
     *  Instance Methods
     *
     */

    // Writes error to stderr using optional formatter:
    // NOTE: Default output is "[category:code:status] message", omitting status when the condition has none
    log(formatter?: HiveQueueServerErrorLogFormatter): void {
        console.error(formatter === undefined
            ? `[${this.category}:${this.code}${this.statusCode === undefined ? "" : `:${this.statusCode}`}] ${this.message}`
            : formatter(this.message, this.code, this.category, this.statusCode)
        );
    }

    /**
     *
     *  Static Methods
     *
     */

    static is(value: unknown): value is HiveQueueServerError {
        return value instanceof HiveQueueServerError;
    }

    /* Configuration (1xxx) */

    static INVALID_PORT(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_PORT,
            "configuration",
            "Port Must Be An Integer Between 0 And 65535!"
        );
    }

    static INVALID_TIMEOUT(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_TIMEOUT,
            "configuration",
            "Timeout Must Be A Positive Integer Of Milliseconds!"
        );
    }

    static INVALID_CONCURRENCY(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_CONCURRENCY,
            "configuration",
            "Concurrency Must Be A Positive Integer!"
        );
    }

    static INVALID_MAX_PENDING(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_MAX_PENDING,
            "configuration",
            "Max Pending Must Be A Positive Integer When Set!"
        );
    }

    static INVALID_MAX_BODY_SIZE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_MAX_BODY_SIZE,
            "configuration",
            "Max Body Size Must Be A Non-Negative Integer Of Bytes!"
        );
    }

    static INVALID_DRAIN_TIMEOUT(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_DRAIN_TIMEOUT,
            "configuration",
            "Drain Timeout Must Be A Positive Integer Of Milliseconds!"
        );
    }

    static INVALID_RETRY_AFTER(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_RETRY_AFTER,
            "configuration",
            "Retry After Must Be A Non-Negative Integer Of Seconds!"
        );
    }

    static INVALID_CORS(reason: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_CORS,
            "configuration",
            `Invalid CORS Config: ${reason}`
        );
    }

    static INVALID_HEADERS(name: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_HEADERS,
            "configuration",
            `Invalid Value For Security Header "${name}"!`
        );
    }

    /* Wiring (2xxx) */

    static UNKNOWN_ROUTE_WORKER(id: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.UNKNOWN_ROUTE_WORKER,
            "wiring",
            `No Worker ID "${id}" Registered For Route!`
        );
    }

    static UNKNOWN_MIDDLEWARE_WORKER(id: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.UNKNOWN_MIDDLEWARE_WORKER,
            "wiring",
            `No Worker ID "${id}" Registered For Middleware!`
        );
    }

    static INVALID_ROUTE(pattern: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_ROUTE,
            "wiring",
            `Invalid Route Pattern "${pattern}"!`
        );
    }

    static INVALID_HANDLER(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INVALID_HANDLER,
            "wiring",
            "Handler Must Be A Worker ID Or A Function!"
        );
    }

    static DUPLICATE_ROUTE(method: string, pattern: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.DUPLICATE_ROUTE,
            "wiring",
            `Route "${method} ${pattern}" Is Already Bound!`
        );
    }

    static LAUNCHED(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.LAUNCHED,
            "wiring",
            "Cannot Modify Server After Launch!"
        );
    }

    /* Lifecycle (3xxx) */

    static SEND_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.SEND_AFTER_DONE,
            "lifecycle",
            "Cannot Send After Task Is Completed!"
        );
    }

    static DONE_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.DONE_AFTER_DONE,
            "lifecycle",
            "Cannot Complete Task More Than Once!"
        );
    }

    static ENV_AFTER_DONE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.ENV_AFTER_DONE,
            "lifecycle",
            "Cannot Access Env After Task Is Completed!"
        );
    }

    static ALREADY_RESPONDED(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.ALREADY_RESPONDED,
            "lifecycle",
            "Response Has Already Been Sent!"
        );
    }

    static UNKNOWN_DELEGATE(id: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.UNKNOWN_DELEGATE,
            "lifecycle",
            `No Worker ID "${id}" To Delegate To!`,
            500
        );
    }

    /* HTTP (4xxx) */

    static NOT_FOUND(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.NOT_FOUND,
            "http",
            "Not Found",
            404
        );
    }

    static PAYLOAD_TOO_LARGE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.PAYLOAD_TOO_LARGE,
            "http",
            "Payload Too Large",
            413
        );
    }

    static MALFORMED_BODY(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.MALFORMED_BODY,
            "http",
            "Malformed Request Body",
            400
        );
    }

    static SERVICE_UNAVAILABLE(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.SERVICE_UNAVAILABLE,
            "http",
            "Service Unavailable",
            503
        );
    }

    static GATEWAY_TIMEOUT(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.GATEWAY_TIMEOUT,
            "http",
            "Gateway Timeout",
            504
        );
    }

    static INTERNAL(cause?: unknown): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.INTERNAL,
            "http",
            "Internal Server Error",
            500,
            { cause }
        );
    }

    static HTTP(statusCode: number, message: string): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.HTTP,
            "http",
            message,
            statusCode
        );
    }

    /* Internal (5xxx) */

    static STREAM_FAILED(cause?: unknown): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.STREAM_FAILED,
            "internal",
            "Response Stream Failed After Headers Were Sent!",
            undefined,
            { cause }
        );
    }

    static TASK_NOT_COMPLETED(): HiveQueueServerError {
        return new HiveQueueServerError(
            HiveQueueServerError.Code.TASK_NOT_COMPLETED,
            "internal",
            "Handler Did Not Complete Its Task Before The Deadline!"
        );
    }

}
