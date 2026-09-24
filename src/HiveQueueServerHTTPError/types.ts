// Type dependencies:
import {
    isHiveQueueServerErrorConfig,                                          // Base config guard the HTTP config builds on
    type HiveQueueServerErrorConfig,                                       // Base construction config this config extends
    type HiveQueueServerErrorLogEntry,                                     // Base log entry this entry extends
} from "../HiveQueueServerError/types.js";

/**
 *
 * Type Declarations
 *
 */

// INTERFACE :: {code:NUMBER, message:nonEmptyString, statusCode:NUMBER?, data:UNKNOWN?}
// Construction config for the HTTP error; statusCode overrides the registry's status for the code.
export interface HiveQueueServerHTTPErrorConfig extends HiveQueueServerErrorConfig {
    readonly statusCode?: number;         // HTTP status; required only for codes with no registered status
}

// INTERFACE :: {error:{message:STRING, code:NUMBER}}
// Body rendered by toResponse() and sent to the client.
export interface HiveQueueServerHTTPErrorResponse {
    error: {
        message: string;                  // Human-readable message
        code: number;                     // Stable code from CODE
    };
}

// INTERFACE :: {timestamp:STRING, code:NUMBER, label:STRING, message:STRING, statusCode:NUMBER}
// The HTTP error's log entry: the base entry plus the status the response is sent with.
export interface HiveQueueServerHTTPErrorLogEntry extends HiveQueueServerErrorLogEntry {
    readonly statusCode: number;          // HTTP status for the response
}

// TYPE :: hiveQueueServerHTTPErrorLogEntry -> STRING
// Formatter accepted by the HTTP error's log(); receives the entry with its status.
export type HiveQueueServerHTTPErrorLogFormatter = (entry: HiveQueueServerHTTPErrorLogEntry) => string;

/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a HiveQueueServerHTTPErrorConfig whose statusCode, if present, is an integer in 100..599
export function isHiveQueueServerHTTPErrorConfig(value: unknown): value is HiveQueueServerHTTPErrorConfig {
    if (!isHiveQueueServerErrorConfig(value)) {
        return false;
    }
    const status = (value as HiveQueueServerHTTPErrorConfig).statusCode;
    return status === undefined || (Number.isInteger(status) && status >= 100 && status <= 599);
}
