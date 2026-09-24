// Type dependencies:
import type { Readable } from "node:stream";   // Streams are one of the accepted body forms

/**
 *
 * Type Declarations
 *
 */

// TYPE :: VOID -> VOID
// Callback invoked exactly once when the response ends; the listener uses it to clear the deadline and release admission.
export type HiveQueueServerResponseOnEnd = () => void;

// TYPE :: STRING|[BYTE]|readable
// Bodies accepted by send(): text, bytes, or a readable stream that is piped.
export type HiveQueueServerResponseBody = string | Uint8Array | Readable;

/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a function usable as the on-end callback
export function isHiveQueueServerResponseOnEnd(value: unknown): value is HiveQueueServerResponseOnEnd {
    return typeof value === "function";
}
