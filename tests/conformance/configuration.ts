import CTGTest from "ctg-js-test";
import CTGTestPredicates from "ctg-js-test/predicates";
import { HiveQueueServer, HiveQueueServerError } from "../../src/index.ts";
import { throwsHiveQueueServerError } from "./helpers.ts";

const Code = HiveQueueServerError.Code;

// Silences the wildcard CORS notice during a call:
const quietly = <T>(fn: () => T): T => {
    const original = console.log;
    console.log = () => {};
    try {
        return fn();
    } finally {
        console.log = original;
    }
};

export default CTGTest.init("configuration")
    .assert("default config resolves documented defaults", () => {
        const server = HiveQueueServer.init();
        return server.port === 3000
            && server.host === undefined
            && server.concurrency === 32
            && server.timeout === 30000
            && server.maxPending === undefined
            && server.maxBodySize === 1048576
            && server.drainTimeout === 10000
            && server.retryAfter === 1
            && server.recover === true
            && server.cors === undefined
            && server.headers === undefined
            && !server.closing
            && !server.launched
            && server.admitted === 0;
    }, CTGTestPredicates.isTrue())
    .assert("queue is constructed active and concurrent with the configured limit", () => {
        const server = HiveQueueServer.init({ concurrency: 4 });
        return server.queue.isActive && server.queue.concurrent && server.queue.concurrency === 4;
    }, CTGTestPredicates.isTrue())
    .assert("env is passed to the queue", () => {
        const server = HiveQueueServer.init<{ n: number }>({ env: { n: 7 } });
        return server.queue.env.n === 7;
    }, CTGTestPredicates.isTrue())
    .assert("invalid port values are rejected", () => {
        return [-1, 65536, 1.5, "80", Number.NaN].every((port) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ port: port as number }), Code.INVALID_PORT)
        ) && HiveQueueServer.init({ port: 0 }).port === 0;
    }, CTGTestPredicates.isTrue())
    .assert("invalid timeout values are rejected", () => {
        return [0, -1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ timeout: v as number }), Code.INVALID_TIMEOUT)
        );
    }, CTGTestPredicates.isTrue())
    .assert("invalid concurrency values are rejected", () => {
        return [0, -1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ concurrency: v as number }), Code.INVALID_CONCURRENCY)
        );
    }, CTGTestPredicates.isTrue())
    .assert("invalid maxPending values are rejected and undefined is allowed", () => {
        return [0, -1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ maxPending: v as number }), Code.INVALID_MAX_PENDING)
        ) && HiveQueueServer.init({ maxPending: 5 }).maxPending === 5;
    }, CTGTestPredicates.isTrue())
    .assert("invalid maxBodySize values are rejected and zero is allowed", () => {
        return [-1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ maxBodySize: v as number }), Code.INVALID_MAX_BODY_SIZE)
        ) && HiveQueueServer.init({ maxBodySize: 0 }).maxBodySize === 0;
    }, CTGTestPredicates.isTrue())
    .assert("invalid drainTimeout values are rejected", () => {
        return [0, -1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ drainTimeout: v as number }), Code.INVALID_DRAIN_TIMEOUT)
        );
    }, CTGTestPredicates.isTrue())
    .assert("invalid retryAfter values are rejected and zero is allowed", () => {
        return [-1, 1.5, "1"].every((v) =>
            throwsHiveQueueServerError(() => HiveQueueServer.init({ retryAfter: v as number }), Code.INVALID_RETRY_AFTER)
        ) && HiveQueueServer.init({ retryAfter: 0 }).retryAfter === 0;
    }, CTGTestPredicates.isTrue())
    .assert("cors origin forms are accepted", () => {
        const a = HiveQueueServer.init({ cors: { origin: "https://a.test" } });
        const b = HiveQueueServer.init({ cors: { origin: ["https://a.test", "https://b.test"] } });
        const c = HiveQueueServer.init({ cors: { origin: (o) => o.endsWith(".test") } });
        const d = quietly(() => HiveQueueServer.init({ cors: { origin: "*" } }));
        return a.cors !== undefined && b.cors !== undefined && c.cors !== undefined && d.cors?.origin === "*";
    }, CTGTestPredicates.isTrue())
    .assert("cors without origin or with a bad origin is rejected", () => {
        return throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: {} as never }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: 42 as never } }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: ["a", 1 as never] } }), Code.INVALID_CORS);
    }, CTGTestPredicates.isTrue())
    .assert("cors wildcard with credentials is rejected", () => {
        return throwsHiveQueueServerError(
            () => HiveQueueServer.init({ cors: { origin: "*", credentials: true } }),
            Code.INVALID_CORS
        );
    }, CTGTestPredicates.isTrue())
    .assert("cors list and scalar fields are validated", () => {
        return throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: "a", methods: "GET" as never } }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: "a", allowedHeaders: [1] as never } }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: "a", exposedHeaders: {} as never } }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: "a", credentials: "yes" as never } }), Code.INVALID_CORS)
            && throwsHiveQueueServerError(() => HiveQueueServer.init({ cors: { origin: "a", maxAge: -1 } }), Code.INVALID_CORS)
            && HiveQueueServer.init({ cors: { origin: "a", methods: ["GET"], allowedHeaders: ["X-A"], exposedHeaders: ["X-B"], credentials: true, maxAge: 600 } }).cors?.maxAge === 600;
    }, CTGTestPredicates.isTrue())
    .assert("headers accepts false, tri-state values, and a CSP directive map", () => {
        const off = HiveQueueServer.init({ headers: false });
        const mixed = HiveQueueServer.init({
            headers: {
                "X-Frame-Options": false,
                "Referrer-Policy": true,
                "X-DNS-Prefetch-Control": "on",
                "Content-Security-Policy": { "default-src": ["'self'"], "img-src": ["'self'", "data:"] }
            }
        });
        return off.headers === false && typeof mixed.headers === "object";
    }, CTGTestPredicates.isTrue())
    .assert("invalid header settings are rejected with the header name", () => {
        const numeric = (() => {
            try {
                HiveQueueServer.init({ headers: { "X-Frame-Options": 42 as never } });
                return false;
            } catch (err) {
                return HiveQueueServerError.is(err) && err.code === Code.INVALID_HEADERS && err.message.includes("X-Frame-Options");
            }
        })();
        const mapOnNonCsp = throwsHiveQueueServerError(
            () => HiveQueueServer.init({ headers: { "X-Frame-Options": { a: ["b"] } } }),
            Code.INVALID_HEADERS
        );
        const badMap = throwsHiveQueueServerError(
            () => HiveQueueServer.init({ headers: { "Content-Security-Policy": { "default-src": "self" as never } } }),
            Code.INVALID_HEADERS
        );
        return numeric && mapOnNonCsp && badMap;
    }, CTGTestPredicates.isTrue())
    .assert("onHalt and onError are chainable and replace the defaults", () => {
        const halt = async () => {};
        const error = () => {};
        const server = HiveQueueServer.init().onHalt(halt).onError(error);
        return server.haltFn === halt && server.onErrorFn === error;
    }, CTGTestPredicates.isTrue());
