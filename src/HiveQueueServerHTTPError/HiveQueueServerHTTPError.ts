// Dependencies:
import HiveQueueServerError from "../HiveQueueServerError/HiveQueueServerError.js";   // Base error whose registry and rules this class inherits

// Type dependencies:
import type { NonEmptyString } from "../shared.types.js";                              // Type of a message that says something
import {
    isHiveQueueServerHTTPErrorConfig,                                                  // Guards the construction config's statusCode
    type HiveQueueServerHTTPErrorConfig,                                               // Construction config shape with optional statusCode
    type HiveQueueServerHTTPErrorLogEntry,                                             // Log entry carrying the status
    type HiveQueueServerHTTPErrorLogFormatter,                                         // Formatter accepted by this class's log()
    type HiveQueueServerHTTPErrorResponse,                                             // Body rendered by toResponse()
} from "./types.js";

/**
 *
 * Class
 *
 */

// HTTP-facing error: a base error that also carries the status the response is sent with
export default class HiveQueueServerHTTPError extends HiveQueueServerError {

    /* Static Fields */
    static readonly STATUS = {                   // Label-to-status registry for conditions with a fixed HTTP status; HTTP takes its status from config
        UNKNOWN_DELEGATE: 500,
        NOT_FOUND: 404,
        PAYLOAD_TOO_LARGE: 413,
        MALFORMED_BODY: 400,
        SERVICE_UNAVAILABLE: 503,
        GATEWAY_TIMEOUT: 504,
        INTERNAL: 500,
        MALFORMED_PATH: 400,
    } as const;

    /* Instance Fields */
    readonly statusCode: number;                 // HTTP status for the response

    // CONSTRUCTOR :: HiveQueueServerHTTPErrorConfig -> this
    // Creates an HTTP error; the status comes from config.statusCode or from STATUS by code
    // NOTE: Inherits the base constructor's INVALID_CODE and INVALID_MESSAGE rejections
    // NOTE: Throws HiveQueueServerError with code -1 (INVALID_CODE) when the code has no registered status and none is given, or the given status is not an integer in 100..599
    constructor(config: HiveQueueServerHTTPErrorConfig) {
        super(config);
        const registered = (HiveQueueServerHTTPError.STATUS as Record<string, number | undefined>)[HiveQueueServerError.labelOf(config.code)];
        const status = isHiveQueueServerHTTPErrorConfig(config)
            ? (config.statusCode ?? registered)
            : undefined;
        if (status === undefined) throw HiveQueueServerError.INVALID_CODE(config.code);
        this.statusCode = status;
    }

    /**
     *
     * Instance Methods
     *
     */

    // INSTANCE :: VOID -> hiveQueueServerHTTPErrorResponse
    // Renders the JSON body sent to the client
    toResponse(): HiveQueueServerHTTPErrorResponse {
        return { error: { message: this.message, code: this.code } };
    }

    // INSTANCE :: hiveQueueServerHTTPErrorLogFormatter? -> VOID
    // Writes the error to standard error; default output is "{timestamp} Code: {label} ({code}), status: {status}, message: {message}"
    // NOTE: A formatter receives the same entry the default line is built from, including the status, and its return value is written instead
    override log(formatter?: HiveQueueServerHTTPErrorLogFormatter): void {
        const entry: HiveQueueServerHTTPErrorLogEntry = {
            timestamp: new Date().toISOString(),
            code: this.code,
            label: this.label,
            message: this.message,
            statusCode: this.statusCode
        };
        console.error(formatter === undefined
            ? `${entry.timestamp} Code: ${entry.label} (${entry.code}), status: ${entry.statusCode}, message: ${entry.message}`
            : formatter(entry)
        );
    }

    /**
     *
     * Static Methods
     *
     */

    // STATIC :: UNKNOWN -> BOOLEAN
    // Narrows an unknown thrown value to HiveQueueServerHTTPError
    static override is(value: unknown): value is HiveQueueServerHTTPError {
        return value instanceof HiveQueueServerHTTPError;
    }


    // STATIC :: STRING -> hiveQueueServerHTTPError
    // A handler or worker delegated to an unregistered worker ID; answered 500
    static UNKNOWN_DELEGATE(id: string): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.UNKNOWN_DELEGATE, message: `No Worker ID "${id}" To Delegate To!` as NonEmptyString });
    }


    // STATIC :: VOID -> hiveQueueServerHTTPError
    // No route matched; 404
    static NOT_FOUND(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.NOT_FOUND, message: "Not Found" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerHTTPError
    // Request body exceeds the configured cap; 413
    static PAYLOAD_TOO_LARGE(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.PAYLOAD_TOO_LARGE, message: "Payload Too Large" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerHTTPError
    // Request body could not be parsed; 400
    static MALFORMED_BODY(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.MALFORMED_BODY, message: "Malformed Request Body" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerHTTPError
    // Server is closing or at its admission limit; 503
    static SERVICE_UNAVAILABLE(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.SERVICE_UNAVAILABLE, message: "Service Unavailable" as NonEmptyString });
    }

    // STATIC :: VOID -> hiveQueueServerHTTPError
    // Request deadline fired before a response; 504
    static GATEWAY_TIMEOUT(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.GATEWAY_TIMEOUT, message: "Gateway Timeout" as NonEmptyString });
    }

    // STATIC :: UNKNOWN? -> hiveQueueServerHTTPError
    // An unexpected failure answered 500; the cause is carried as data
    static INTERNAL(cause?: unknown): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.INTERNAL, message: "Internal Server Error" as NonEmptyString, data: cause });
    }

    // STATIC :: NUMBER, STRING -> hiveQueueServerHTTPError
    // A deliberate HTTP error thrown by a handler with its own status and message
    // NOTE: Throws INVALID_MESSAGE for an empty message and INVALID_CODE for a status outside 100..599
    static HTTP(statusCode: number, message: string): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.HTTP, message: message as NonEmptyString, statusCode });
    }

    // STATIC :: VOID -> hiveQueueServerHTTPError
    // Request path has invalid percent-encoding; 400
    static MALFORMED_PATH(): HiveQueueServerHTTPError {
        return new HiveQueueServerHTTPError({ code: HiveQueueServerError.CODE.MALFORMED_PATH, message: "Malformed Request Path" as NonEmptyString });
    }

}
