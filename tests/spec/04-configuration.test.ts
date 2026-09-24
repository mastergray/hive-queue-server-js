// realizes: docs/hive-queue-server-design-doc.md > Conformance Test Cases > Configuration

// Dependencies:
import CTGTest, { CTGTestPredicates as P } from "ctg-js-test";                    // Pipeline API and predicate builders
import { HiveQueueServer, HiveQueueServerError } from "../../src/index.ts";       // Class under test and its error codes
import { quietly, thrownBy } from "../support/fixtures.ts";                       // Notice silencing and thrown-value capture

// Type dependencies:
import type { TestFile } from "../run.ts";                                        // Manifest contract consumed by the runner
import type { HiveQueueServerConfig } from "../../src/index.ts";                  // Config shape for deliberately invalid inputs

/**
 *
 * Constants
 *
 */

const { CODE } = HiveQueueServerError;

const codeOf = (value: unknown): number | null => HiveQueueServerError.is(value) ? value.code : null;
const rejects = (config: HiveQueueServerConfig): number | null => codeOf(thrownBy(() => HiveQueueServer.init(config)));

// Codes produced for each invalid value of a numeric field, as a snapshot:
const numericRejections = (field: keyof HiveQueueServerConfig, values: unknown[]): (number | null)[] =>
    values.map((v) => rejects({ [field]: v } as HiveQueueServerConfig));

/**
 *
 * Manifest
 *
 */

const testFile: TestFile = {
    label: "configuration",
    cases: [
        {
            label: "default config resolves the documented defaults",
            run: () => CTGTest.init("defaults")
                .stage("construct", () => HiveQueueServer.init())
                .assert("snapshot", ({ subject: s }) => ({
                    port: s.port, host: s.host, concurrency: s.concurrency, timeout: s.timeout, maxPending: s.maxPending,
                    maxBodySize: s.maxBodySize, drainTimeout: s.drainTimeout, retryAfter: s.retryAfter, recover: s.recover,
                    cors: s.cors, headers: s.headers, closing: s.closing, launched: s.launched, admitted: s.admitted
                }), P.equals<{ port: number, host: string | undefined, concurrency: number, timeout: number, maxPending: number | undefined, maxBodySize: number, drainTimeout: number, retryAfter: number, recover: boolean, cors: unknown, headers: unknown, closing: boolean, launched: boolean, admitted: number }>({
                    port: 3000, host: undefined, concurrency: 32, timeout: 30000, maxPending: undefined,
                    maxBodySize: 1048576, drainTimeout: 10000, retryAfter: 1, recover: true,
                    cors: undefined, headers: undefined, closing: false, launched: false, admitted: 0
                }))
                .start(undefined)
        },
        {
            label: "the queue is constructed active and concurrent with the configured limit",
            run: () => CTGTest.init("queue")
                .stage("construct", () => HiveQueueServer.init({ concurrency: 4 }).queue)
                .assert("snapshot", ({ subject: q }) => ({ active: q.isActive, concurrent: q.concurrent, concurrency: q.concurrency }), P.equals<{ active: boolean, concurrent: boolean, concurrency: number }>({ active: true, concurrent: true, concurrency: 4 }))
                .start(undefined)
        },
        {
            label: "env is passed to the queue",
            run: () => CTGTest.init("env")
                .assert("n", () => HiveQueueServer.init<{ n: number }>({ env: { n: 7 } }).queue.env.n, P.equals(7))
                .start(undefined)
        },
        {
            label: "port must be an integer in 0..65535; 0 is accepted",
            run: () => CTGTest.init("port")
                .assert("rejections", () => numericRejections("port", [-1, 65536, 1.5, "80", Number.NaN]), P.equals<(number | null)[]>(Array(5).fill(CODE.INVALID_PORT)))
                .assert("zero accepted", () => HiveQueueServer.init({ port: 0 }).port, P.equals(0))
                .start(undefined)
        },
        {
            label: "timeout must be a positive integer",
            run: () => CTGTest.init("timeout")
                .assert("rejections", () => numericRejections("timeout", [0, -1, 1.5, "1"]), P.equals<(number | null)[]>(Array(4).fill(CODE.INVALID_TIMEOUT)))
                .start(undefined)
        },
        {
            label: "concurrency must be a positive integer",
            run: () => CTGTest.init("concurrency")
                .assert("rejections", () => numericRejections("concurrency", [0, -1, 1.5, "1"]), P.equals<(number | null)[]>(Array(4).fill(CODE.INVALID_CONCURRENCY)))
                .start(undefined)
        },
        {
            label: "maxPending, when present, must be a positive integer",
            run: () => CTGTest.init("maxPending")
                .assert("rejections", () => numericRejections("maxPending", [0, -1, 1.5, "1"]), P.equals<(number | null)[]>(Array(4).fill(CODE.INVALID_MAX_PENDING)))
                .assert("accepted", () => HiveQueueServer.init({ maxPending: 5 }).maxPending, P.equals<number | undefined>(5))
                .start(undefined)
        },
        {
            label: "maxBodySize must be a non-negative integer; 0 is accepted",
            run: () => CTGTest.init("maxBodySize")
                .assert("rejections", () => numericRejections("maxBodySize", [-1, 1.5, "1"]), P.equals<(number | null)[]>(Array(3).fill(CODE.INVALID_MAX_BODY_SIZE)))
                .assert("zero accepted", () => HiveQueueServer.init({ maxBodySize: 0 }).maxBodySize, P.equals(0))
                .start(undefined)
        },
        {
            label: "drainTimeout must be a positive integer",
            run: () => CTGTest.init("drainTimeout")
                .assert("rejections", () => numericRejections("drainTimeout", [0, -1, 1.5, "1"]), P.equals<(number | null)[]>(Array(4).fill(CODE.INVALID_DRAIN_TIMEOUT)))
                .start(undefined)
        },
        {
            label: "retryAfter must be a non-negative integer; 0 is accepted",
            run: () => CTGTest.init("retryAfter")
                .assert("rejections", () => numericRejections("retryAfter", [-1, 1.5, "1"]), P.equals<(number | null)[]>(Array(3).fill(CODE.INVALID_RETRY_AFTER)))
                .assert("zero accepted", () => HiveQueueServer.init({ retryAfter: 0 }).retryAfter, P.equals(0))
                .start(undefined)
        },
        {
            label: "cors.origin accepts a string, a list, a predicate, and the wildcard",
            run: () => CTGTest.init("cors origin forms")
                .assert("all accepted", () => ({
                    string: HiveQueueServer.init({ cors: { origin: "https://a.test" } }).cors?.origin,
                    list: HiveQueueServer.init({ cors: { origin: ["https://a.test", "https://b.test"] } }).cors?.origin,
                    predicate: typeof HiveQueueServer.init({ cors: { origin: (o) => o.endsWith(".test") } }).cors?.origin,
                    wildcard: quietly(() => HiveQueueServer.init({ cors: { origin: "*" } })).cors?.origin
                }), P.equals<{ string: unknown, list: unknown, predicate: string, wildcard: unknown }>({ string: "https://a.test", list: ["https://a.test", "https://b.test"], predicate: "function", wildcard: "*" }))
                .start(undefined)
        },
        {
            label: "cors without an origin or with a malformed field is rejected with INVALID_CORS",
            run: () => CTGTest.init("cors shape")
                .assert("rejections", () => [
                    rejects({ cors: {} as never }),
                    rejects({ cors: { origin: 42 as never } }),
                    rejects({ cors: { origin: ["a", 1 as never] } }),
                    rejects({ cors: { origin: "a", methods: "GET" as never } }),
                    rejects({ cors: { origin: "a", allowedHeaders: [1] as never } }),
                    rejects({ cors: { origin: "a", exposedHeaders: {} as never } }),
                    rejects({ cors: { origin: "a", credentials: "yes" as never } }),
                    rejects({ cors: { origin: "a", maxAge: -1 } })
                ], P.equals<(number | null)[]>(Array(8).fill(CODE.INVALID_CORS)))
                .assert("full valid config accepted", () => HiveQueueServer.init({ cors: { origin: "a", methods: ["GET"], allowedHeaders: ["X-A"], exposedHeaders: ["X-B"], credentials: true, maxAge: 600 } }).cors?.maxAge, P.equals<number | undefined>(600))
                .start(undefined)
        },
        {
            label: "cors origin \"*\" with credentials is rejected with INVALID_CORS",
            run: () => CTGTest.init("wildcard credentials")
                .assert("code", () => rejects({ cors: { origin: "*", credentials: true } }), P.equals<number | null>(CODE.INVALID_CORS))
                .start(undefined)
        },
        {
            label: "headers accepts false, tri-state values, and a CSP directive map",
            run: () => CTGTest.init("headers forms")
                .assert("snapshot", () => ({
                    off: HiveQueueServer.init({ headers: false }).headers,
                    mixed: typeof HiveQueueServer.init({ headers: { "X-Frame-Options": false, "Referrer-Policy": true, "X-DNS-Prefetch-Control": "on", "Content-Security-Policy": { "default-src": ["'self'"], "img-src": ["'self'", "data:"] } } }).headers
                }), P.equals<{ off: unknown, mixed: string }>({ off: false, mixed: "object" }))
                .start(undefined)
        },
        {
            label: "an invalid header setting is rejected with INVALID_HEADERS naming the header",
            run: () => CTGTest.init("headers rejections")
                .stage("numeric value", () => thrownBy(() => HiveQueueServer.init({ headers: { "X-Frame-Options": 42 as never } })))
                .assert("names the header", ({ subject }) => ({ code: codeOf(subject), names: HiveQueueServerError.is(subject) && subject.message.includes("X-Frame-Options") }),
                    P.equals<{ code: number | null, names: boolean }>({ code: CODE.INVALID_HEADERS, names: true }))
                .assert("map on a non-CSP header and a bad CSP map", () => [
                    rejects({ headers: { "X-Frame-Options": { a: ["b"] } } }),
                    rejects({ headers: { "Content-Security-Policy": { "default-src": "self" as never } } })
                ], P.equals<(number | null)[]>([CODE.INVALID_HEADERS, CODE.INVALID_HEADERS]))
                .start(undefined)
        },
        {
            label: "onHalt and onError are chainable, replace the handlers, and reject non-functions with INVALID_CALLBACK",
            run: () => CTGTest.init("callbacks")
                .stage("set", () => {
                    const halt = async () => {};
                    const error = () => {};
                    const server = HiveQueueServer.init().onHalt(halt).onError(error);
                    return { server, halt, error };
                })
                .assert("replaced", ({ subject: { server, halt, error } }) => ({ halt: server.haltHandler === halt, error: server.errorHandler === error }), P.equals<{ halt: boolean, error: boolean }>({ halt: true, error: true }))
                .assert("rejections", ({ subject: { server } }) => [
                    codeOf(thrownBy(() => server.onHalt("x" as never))),
                    codeOf(thrownBy(() => server.onError(42 as never))),
                    rejects({ onHalt: "x" as never }),
                    rejects({ onError: 42 as never })
                ], P.equals<(number | null)[]>(Array(4).fill(CODE.INVALID_CALLBACK)))
                .start(undefined)
        }
    ]
};

export default testFile;
