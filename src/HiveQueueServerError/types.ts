// Type dependencies:
import { isNonEmptyString, type NonEmptyString } from "../shared.types.js";   // Every error message must say something

/**
 *
 * Type Declarations
 *
 */

// INTERFACE :: {code:NUMBER, message:nonEmptyString, data:UNKNOWN?}
// Construction config accepted by the base error constructor and init().
export interface HiveQueueServerErrorConfig {
    readonly code: number;                // Registry code; validated by the constructor
    readonly message: NonEmptyString;     // Human-readable message; must say something
    readonly data?: unknown;              // Detail of any kind; null when omitted
}

// INTERFACE :: {timestamp:STRING, code:NUMBER, label:STRING, message:STRING}
// Everything the base log() knows about an error at the moment it is logged; passed to a formatter.
export interface HiveQueueServerErrorLogEntry {
    readonly timestamp: string;           // ISO 8601 time of the log call
    readonly code: number;                // Registry code
    readonly label: string;               // Registry label for the code
    readonly message: string;             // Human-readable message
}

// TYPE :: hiveQueueServerErrorLogEntry -> STRING
// Formatter accepted by the base log(); its return value is written instead of the default line.
export type HiveQueueServerErrorLogFormatter = (entry: HiveQueueServerErrorLogEntry) => string;



/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a HiveQueueServerErrorConfig with a numeric code and a non-empty message
export function isHiveQueueServerErrorConfig(value: unknown): value is HiveQueueServerErrorConfig {
    return typeof value === "object" && value !== null
        && typeof (value as HiveQueueServerErrorConfig).code === "number"
        && isNonEmptyString((value as HiveQueueServerErrorConfig).message);
}
