// Shared test functions: thrown-value capture, console capture, and timing.

/**
 *
 * Functions
 *
 */

// HELPER :: (VOID -> UNKNOWN) -> UNKNOWN
// Calls fn and returns what it threw, or undefined when it returned normally
export const thrownBy = (fn: () => unknown): unknown => {
    try {
        fn();
        return undefined;
    } catch (error) {
        return error;
    }
};

// HELPER :: (VOID -> PROMISE(UNKNOWN)) -> PROMISE(UNKNOWN)
// Awaits fn and returns what it rejected with, or undefined when it resolved
export const rejectedBy = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
        await fn();
        return undefined;
    } catch (error) {
        return error;
    }
};

// HELPER :: NUMBER? -> PROMISE(VOID)
// Resolves after ms milliseconds (default 10) so deferred work can settle
export const wait = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// HELPER :: (VOID -> VOID) -> STRING
// Runs fn with console.error captured and returns the last line written
export const capturedError = (fn: () => void): string => {
    const original = console.error;
    let logged = "";
    console.error = (value?: unknown) => {
        logged = String(value);
    };
    try {
        fn();
    } finally {
        console.error = original;
    }
    return logged;
};

// HELPER :: (VOID -> T) -> T
// Runs fn with console.log silenced, for constructions that print notices
export const quietly = <T>(fn: () => T): T => {
    const original = console.log;
    console.log = () => {};
    try {
        return fn();
    } finally {
        console.log = original;
    }
};
