import CTGTest from "ctg-js-test";
import CTGTestPredicates from "ctg-js-test/predicates";
import { HiveQueueError } from "hive-queue";
import { HiveQueueServerError } from "../../src/index.ts";

// Every canonical condition with its expected code, category, and status:
const TABLE: [string, number, string, number | undefined][] = [
    ["INVALID_PORT", 1000, "configuration", undefined],
    ["INVALID_TIMEOUT", 1001, "configuration", undefined],
    ["INVALID_CONCURRENCY", 1002, "configuration", undefined],
    ["INVALID_MAX_PENDING", 1003, "configuration", undefined],
    ["INVALID_MAX_BODY_SIZE", 1004, "configuration", undefined],
    ["INVALID_DRAIN_TIMEOUT", 1005, "configuration", undefined],
    ["INVALID_RETRY_AFTER", 1006, "configuration", undefined],
    ["INVALID_CORS", 1007, "configuration", undefined],
    ["INVALID_HEADERS", 1008, "configuration", undefined],
    ["UNKNOWN_ROUTE_WORKER", 2000, "wiring", undefined],
    ["UNKNOWN_MIDDLEWARE_WORKER", 2001, "wiring", undefined],
    ["INVALID_ROUTE", 2002, "wiring", undefined],
    ["INVALID_HANDLER", 2003, "wiring", undefined],
    ["DUPLICATE_ROUTE", 2004, "wiring", undefined],
    ["LAUNCHED", 2005, "wiring", undefined],
    ["SEND_AFTER_DONE", 3000, "lifecycle", undefined],
    ["DONE_AFTER_DONE", 3001, "lifecycle", undefined],
    ["ENV_AFTER_DONE", 3002, "lifecycle", undefined],
    ["ALREADY_RESPONDED", 3003, "lifecycle", undefined],
    ["UNKNOWN_DELEGATE", 3004, "lifecycle", 500],
    ["NOT_FOUND", 4000, "http", 404],
    ["PAYLOAD_TOO_LARGE", 4001, "http", 413],
    ["MALFORMED_BODY", 4002, "http", 400],
    ["SERVICE_UNAVAILABLE", 4003, "http", 503],
    ["GATEWAY_TIMEOUT", 4004, "http", 504],
    ["INTERNAL", 4005, "http", 500],
    ["STREAM_FAILED", 5000, "internal", undefined],
    ["TASK_NOT_COMPLETED", 5001, "internal", undefined]
];

// Invokes a factory by name with placeholder arguments:
const construct = (name: string): HiveQueueServerError => {
    const factory = (HiveQueueServerError as unknown as Record<string, (...args: unknown[]) => HiveQueueServerError>)[name];
    if (factory === undefined) {
        throw new Error(`No factory ${name}`);
    }
    return factory("x", "y");
};

const captureError = (fn: () => void): string => {
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

export default CTGTest.init("error class")
    .assert("every factory produces its table code, category, and status", () => {
        return TABLE.every(([name, code, category, status]) => {
            const err = construct(name);
            return err.code === code
                && err.category === category
                && err.statusCode === status
                && HiveQueueServerError.Code[name as keyof typeof HiveQueueServerError.Code] === code;
        });
    }, CTGTestPredicates.isTrue())
    .assert("every table condition has a factory and vice versa", () => {
        const codeNames = Object.keys(HiveQueueServerError.Code).sort();
        // HTTP is tested separately because its status is caller-supplied:
        const tableNames = [...TABLE.map(([name]) => name), "HTTP"].sort();
        return codeNames.join(",") === tableNames.join(",");
    }, CTGTestPredicates.isTrue())
    .assert("HTTP factory carries given status and message", () => {
        const err = HiveQueueServerError.HTTP(418, "teapot");
        return err.code === HiveQueueServerError.Code.HTTP
            && err.category === "http"
            && err.statusCode === 418
            && err.message === "teapot";
    }, CTGTestPredicates.isTrue())
    .assert("INTERNAL and STREAM_FAILED chain cause", () => {
        const cause = new Error("boom");
        return HiveQueueServerError.INTERNAL(cause).cause === cause
            && HiveQueueServerError.STREAM_FAILED(cause).cause === cause;
    }, CTGTestPredicates.isTrue())
    .assert("wiring and delegate messages include the offending ID", () => {
        return HiveQueueServerError.UNKNOWN_ROUTE_WORKER("ghost").message.includes("ghost")
            && HiveQueueServerError.UNKNOWN_MIDDLEWARE_WORKER("ghost").message.includes("ghost")
            && HiveQueueServerError.UNKNOWN_DELEGATE("ghost").message.includes("ghost")
            && HiveQueueServerError.INVALID_ROUTE("bad").message.includes("bad")
            && HiveQueueServerError.DUPLICATE_ROUTE("GET", "/x").message.includes("GET /x")
            && HiveQueueServerError.INVALID_HEADERS("X-A").message.includes("X-A");
    }, CTGTestPredicates.isTrue())
    .assert("is narrows server errors only", () => {
        return HiveQueueServerError.is(HiveQueueServerError.NOT_FOUND())
            && !HiveQueueServerError.is(HiveQueueError.INVALID_TASK())
            && !HiveQueueServerError.is(new Error("native"))
            && !HiveQueueServerError.is("string")
            && !HiveQueueServerError.is(null);
    }, CTGTestPredicates.isTrue())
    .assert("server errors are native errors with the class name", () => {
        const err = HiveQueueServerError.NOT_FOUND();
        return err instanceof Error && err.name === "HiveQueueServerError";
    }, CTGTestPredicates.isTrue())
    .assert("log includes status for http conditions", () => {
        return captureError(() => HiveQueueServerError.NOT_FOUND().log());
    }, CTGTestPredicates.equals("[http:4000:404] Not Found"))
    .assert("log omits status for conditions without one", () => {
        return captureError(() => HiveQueueServerError.LAUNCHED().log());
    }, CTGTestPredicates.equals("[wiring:2005] Cannot Modify Server After Launch!"))
    .assert("log formatter receives message, code, category, and status", () => {
        return captureError(() => HiveQueueServerError.GATEWAY_TIMEOUT().log(
            (message, code, category, status) => `${category}|${code}|${status}|${message}`
        ));
    }, CTGTestPredicates.equals("http|4004|504|Gateway Timeout"))
    .assert("Code map is usable without constructing an error", () => {
        return HiveQueueServerError.Code.NOT_FOUND === 4000;
    }, CTGTestPredicates.isTrue());
