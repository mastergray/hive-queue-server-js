/**
 *
 * Type Declarations
 *
 */

// TYPE :: STRING & {__nonEmpty:TRUE}
// A string with at least one non-whitespace character; the type every error message must have.
// NOTE: The brand is erased at runtime; isNonEmptyString() is the only way to obtain one.
export type NonEmptyString = string & { readonly __nonEmpty: true };

/**
 *
 * Type Predicates
 *
 */

// PREDICATE :: UNKNOWN -> BOOLEAN
// True when value is a string containing at least one non-whitespace character
export function isNonEmptyString(value: unknown): value is NonEmptyString {
    return typeof value === "string" && value.trim().length > 0;
}
