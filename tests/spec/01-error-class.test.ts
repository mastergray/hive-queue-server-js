// realizes: docs/hive-queue-server-design-doc.md > Conformance Test Cases > Error Class

// Dependencies:
import CTGTest, { CTGTestPredicates as P } from "ctg-js-test";                        // Pipeline API and predicate builders
import { HiveQueueError } from "hive-queue";                                          // A queue error, which is() must reject
import { HiveQueueServerError, HiveQueueServerHTTPError } from "../../src/index.ts";  // Classes under test, via the public surface
import { capturedError, thrownBy } from "../support/fixtures.ts";                     // Console capture and thrown-value capture

// Type dependencies:
import type { TestFile } from "../run.ts";                                            // Manifest contract consumed by the runner
import type { NonEmptyString } from "../../src/index.ts";                              // Message type for direct construction

/**
 *
 * Constants
 *
 */

const { CODE } = HiveQueueServerError;

// Every fixed condition with its expected code, status, and the class its factory returns:
const CONDITIONS: [string, number, number | undefined, "base" | "http"][] = [
    ["INVALID_PORT", 1, undefined, "base"],
    ["INVALID_TIMEOUT", 2, undefined, "base"],
    ["INVALID_CONCURRENCY", 3, undefined, "base"],
    ["INVALID_MAX_PENDING", 4, undefined, "base"],
    ["INVALID_MAX_BODY_SIZE", 5, undefined, "base"],
    ["INVALID_DRAIN_TIMEOUT", 6, undefined, "base"],
    ["INVALID_RETRY_AFTER", 7, undefined, "base"],
    ["INVALID_CORS", 8, undefined, "base"],
    ["INVALID_HEADERS", 9, undefined, "base"],
    ["INVALID_CALLBACK", 10, undefined, "base"],
    ["UNKNOWN_ROUTE_WORKER", 11, undefined, "base"],
    ["UNKNOWN_MIDDLEWARE_WORKER", 12, undefined, "base"],
    ["INVALID_ROUTE", 13, undefined, "base"],
    ["INVALID_HANDLER", 14, undefined, "base"],
    ["DUPLICATE_ROUTE", 15, undefined, "base"],
    ["LAUNCHED", 16, undefined, "base"],
    ["SEND_AFTER_DONE", 17, undefined, "base"],
    ["DONE_AFTER_DONE", 18, undefined, "base"],
    ["ENV_AFTER_DONE", 19, undefined, "base"],
    ["ALREADY_RESPONDED", 20, undefined, "base"],
    ["UNKNOWN_DELEGATE", 21, 500, "http"],
    ["NOT_FOUND", 22, 404, "http"],
    ["PAYLOAD_TOO_LARGE", 23, 413, "http"],
    ["MALFORMED_BODY", 24, 400, "http"],
    ["SERVICE_UNAVAILABLE", 25, 503, "http"],
    ["GATEWAY_TIMEOUT", 26, 504, "http"],
    ["INTERNAL", 27, 500, "http"],
    ["MALFORMED_PATH", 29, 400, "http"],
    ["STREAM_FAILED", 30, undefined, "base"],
    ["TASK_NOT_COMPLETED", 31, undefined, "base"]
];

// Invokes a factory by name on the class that owns it, with placeholder arguments:
const construct = (name: string, owner: "base" | "http"): HiveQueueServerError => {
    const cls = (owner === "base" ? HiveQueueServerError : HiveQueueServerHTTPError) as unknown as Record<string, (...args: unknown[]) => HiveQueueServerError>;
    const factory = cls[name];
    if (factory === undefined) throw new Error(`No factory ${name}`);
    return factory("x", "y");
};

const message = "m" as NonEmptyString;

/**
 *
 * Manifest
 *
 */

const testFile: TestFile = {
    label: "error class",
    cases: [
        {
            label: "every fixed condition's factory produces its table code, status, label, and class",
            run: () => CTGTest.init("factory table")
                .assert("all conditions match", () => CONDITIONS.filter(([name, code, status, owner]) => {
                    const err = construct(name, owner);
                    return !(err.code === code
                        && (HiveQueueServerHTTPError.is(err) ? err.statusCode : undefined) === status
                        && err.label === name
                        && CODE[name as keyof typeof CODE] === code
                        && HiveQueueServerHTTPError.is(err) === (owner === "http"));
                }).map(([name]) => name), P.equals<string[]>([]))
                .start(undefined)
        },
        {
            label: "CODE registry holds exactly the table conditions plus HTTP and the constructor sentinels",
            run: () => CTGTest.init("registry completeness")
                .assert("names agree", () => Object.keys(CODE).sort(), P.equals<string[]>(
                    [...CONDITIONS.map(([name]) => name), "HTTP", "INVALID_CODE", "INVALID_MESSAGE"].sort()
                ))
                .assert("sentinels", () => ({ invalidCode: CODE.INVALID_CODE, invalidMessage: CODE.INVALID_MESSAGE }), P.equals<{ invalidCode: number, invalidMessage: number }>({ invalidCode: -1, invalidMessage: 32 }))
                .start(undefined)
        },
        {
            label: "HTTP(statusCode, message) carries the given status and message under the HTTP code",
            run: () => CTGTest.init("HTTP factory")
                .stage("construct", () => HiveQueueServerHTTPError.HTTP(418, "teapot"))
                .assert("snapshot", ({ subject }) => ({ code: subject.code, label: subject.label, status: subject.statusCode, message: subject.message as string }),
                    P.equals<{ code: number, label: string, status: number, message: string }>({ code: CODE.HTTP, label: "HTTP", status: 418, message: "teapot" }))
                .start(undefined)
        },
        {
            label: "INTERNAL and STREAM_FAILED carry the cause as data",
            run: () => CTGTest.init("cause as data")
                .stage("construct", () => new Error("boom"))
                .assert("both carry it", ({ subject }) => ({
                    internal: HiveQueueServerHTTPError.INTERNAL(subject).data === subject,
                    stream: HiveQueueServerError.STREAM_FAILED(subject).data === subject
                }), P.equals<{ internal: boolean, stream: boolean }>({ internal: true, stream: true }))
                .start(undefined)
        },
        {
            label: "data is null when omitted",
            run: () => CTGTest.init("data default")
                .assert("null", () => HiveQueueServerError.init({ code: CODE.LAUNCHED, message }).data, P.equals<unknown>(null))
                .start(undefined)
        },
        {
            label: "wiring, delegate, and header messages include the offending identifier",
            run: () => CTGTest.init("messages name the offender")
                .assert("all include it", () => ({
                    routeWorker: HiveQueueServerError.UNKNOWN_ROUTE_WORKER("ghost").message.includes("ghost"),
                    middlewareWorker: HiveQueueServerError.UNKNOWN_MIDDLEWARE_WORKER("ghost").message.includes("ghost"),
                    delegate: HiveQueueServerHTTPError.UNKNOWN_DELEGATE("ghost").message.includes("ghost"),
                    route: HiveQueueServerError.INVALID_ROUTE("bad").message.includes("bad"),
                    duplicate: HiveQueueServerError.DUPLICATE_ROUTE("GET", "/x").message.includes("GET /x"),
                    header: HiveQueueServerError.INVALID_HEADERS("X-A").message.includes("X-A"),
                    callback: HiveQueueServerError.INVALID_CALLBACK("onHalt").message.includes("onHalt")
                }), P.equals<Record<string, boolean>>({ routeWorker: true, middlewareWorker: true, delegate: true, route: true, duplicate: true, header: true, callback: true }))
                .start(undefined)
        },
        {
            label: "constructor rejects a code outside CODE with a plain base error of code -1",
            run: () => CTGTest.init("unknown code")
                .stage("construct with 999", () => thrownBy(() => new HiveQueueServerHTTPError({ code: 999, message })))
                .assert("plain base error, code -1", ({ subject }) => ({
                    isBase: HiveQueueServerError.is(subject),
                    isHttp: HiveQueueServerHTTPError.is(subject),
                    code: HiveQueueServerError.is(subject) ? subject.code : null,
                    hasMessage: HiveQueueServerError.is(subject) && subject.message.length > 0
                }), P.equals<{ isBase: boolean, isHttp: boolean, code: number | null, hasMessage: boolean }>({ isBase: true, isHttp: false, code: -1, hasMessage: true }))
                .start(undefined)
        },
        {
            label: "INVALID_CODE and INVALID_MESSAGE factories produce the sentinel and message conditions with data",
            run: () => CTGTest.init("constructor-condition factories")
                .assert("snapshot", () => {
                    const invalid = HiveQueueServerError.INVALID_CODE(999);
                    const message = HiveQueueServerError.INVALID_MESSAGE("");
                    return { invalidCode: invalid.code, invalidData: invalid.data, invalidIsBase: HiveQueueServerError.is(invalid), messageCode: message.code, messageData: message.data };
                }, P.equals<{ invalidCode: number, invalidData: unknown, invalidIsBase: boolean, messageCode: number, messageData: unknown }>({ invalidCode: -1, invalidData: 999, invalidIsBase: true, messageCode: CODE.INVALID_MESSAGE, messageData: "" }))
                .start(undefined)
        },
        {
            label: "constructor rejects the INVALID_CODE sentinel itself with code -1",
            run: () => CTGTest.init("sentinel")
                .stage("construct with -1", () => thrownBy(() => HiveQueueServerError.init({ code: -1, message })))
                .assert("code -1", ({ subject }) => HiveQueueServerError.is(subject) ? subject.code : null, P.equals<number | null>(-1))
                .start(undefined)
        },
        {
            label: "constructor rejects an empty or whitespace message with INVALID_MESSAGE",
            run: () => CTGTest.init("empty message")
                .stage("construct", () => [
                    thrownBy(() => HiveQueueServerError.init({ code: CODE.LAUNCHED, message: "" as NonEmptyString })),
                    thrownBy(() => HiveQueueServerError.init({ code: CODE.LAUNCHED, message: "   " as NonEmptyString }))
                ])
                .assert("both INVALID_MESSAGE", ({ subject }) => subject.map((e) => HiveQueueServerError.is(e) ? e.code : null), P.equals<(number | null)[]>([CODE.INVALID_MESSAGE, CODE.INVALID_MESSAGE]))
                .start(undefined)
        },
        {
            label: "HTTP subclass rejects a code with no registered status and no given status with code -1",
            run: () => CTGTest.init("no status")
                .stage("construct LAUNCHED as http", () => thrownBy(() => new HiveQueueServerHTTPError({ code: CODE.LAUNCHED, message })))
                .assert("code -1", ({ subject }) => HiveQueueServerError.is(subject) ? subject.code : null, P.equals<number | null>(-1))
                .start(undefined)
        },
        {
            label: "HTTP subclass rejects a status outside 100..599 with code -1",
            run: () => CTGTest.init("bad status")
                .stage("construct", () => [99, 600, 1.5].map((s) => thrownBy(() => HiveQueueServerHTTPError.HTTP(s, "m"))))
                .assert("all code -1", ({ subject }) => subject.map((e) => HiveQueueServerError.is(e) ? e.code : null), P.equals<(number | null)[]>([-1, -1, -1]))
                .start(undefined)
        },
        {
            label: "is narrows to server errors only, and the HTTP is narrows further",
            run: () => CTGTest.init("is")
                .assert("snapshot", () => ({
                    baseOnBase: HiveQueueServerError.is(HiveQueueServerError.LAUNCHED()),
                    baseOnHttp: HiveQueueServerError.is(HiveQueueServerHTTPError.NOT_FOUND()),
                    httpOnBase: HiveQueueServerHTTPError.is(HiveQueueServerError.LAUNCHED()),
                    queueError: HiveQueueServerError.is(HiveQueueError.INVALID_TASK()),
                    native: HiveQueueServerError.is(new Error("native")),
                    string: HiveQueueServerError.is("string"),
                    nul: HiveQueueServerError.is(null)
                }), P.equals<Record<string, boolean>>({ baseOnBase: true, baseOnHttp: true, httpOnBase: false, queueError: false, native: false, string: false, nul: false }))
                .start(undefined)
        },
        {
            label: "errors are native errors named HiveQueueServerError",
            run: () => CTGTest.init("native")
                .assert("snapshot", () => {
                    const err = HiveQueueServerHTTPError.NOT_FOUND();
                    return { isError: err instanceof Error, name: err.name };
                }, P.equals<{ isError: boolean, name: string }>({ isError: true, name: "HiveQueueServerError" }))
                .start(undefined)
        },
        {
            label: "toResponse renders the error body the client receives",
            run: () => CTGTest.init("toResponse")
                .assert("body", () => HiveQueueServerHTTPError.NOT_FOUND().toResponse(), P.equals<{ error: { message: string, code: number } }>({ error: { message: "Not Found", code: CODE.NOT_FOUND } }))
                .start(undefined)
        },
        {
            label: "log writes a timestamp, then Code: label (code), status, and message for conditions with a status",
            run: () => CTGTest.init("log with status")
                .assert("line", () => capturedError(() => HiveQueueServerHTTPError.NOT_FOUND().log()),
                    P.matchesPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Code: NOT_FOUND \(22\), status: 404, message: Not Found$/))
                .start(undefined)
        },
        {
            label: "log omits the status part for conditions without one",
            run: () => CTGTest.init("log without status")
                .assert("line", () => capturedError(() => HiveQueueServerError.LAUNCHED().log()),
                    P.matchesPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Code: LAUNCHED \(16\), message: Cannot Modify Server After Launch!$/))
                .start(undefined)
        },
        {
            label: "HTTP log formatter receives an entry with timestamp, code, label, message, and status; the base formatter's entry has no status key",
            run: () => CTGTest.init("log formatter")
                .assert("line", () => capturedError(() => HiveQueueServerHTTPError.GATEWAY_TIMEOUT().log(
                    (entry) => `${entry.label}|${entry.code}|${entry.statusCode}|${entry.message}|${/^\d{4}-\d{2}-\d{2}T/.test(entry.timestamp)}`
                )), P.equals("GATEWAY_TIMEOUT|26|504|Gateway Timeout|true"))
                .assert("base entry has no statusCode key at all", () => {
                    let seen: { code: number, label: string, hasStatusKey: boolean, message: string } | undefined;
                    capturedError(() => HiveQueueServerError.LAUNCHED().log((entry) => {
                        seen = { code: entry.code, label: entry.label, hasStatusKey: "statusCode" in entry, message: entry.message };
                        return "";
                    }));
                    return seen;
                }, P.equals<{ code: number, label: string, hasStatusKey: boolean, message: string } | undefined>({ code: CODE.LAUNCHED, label: "LAUNCHED", hasStatusKey: false, message: "Cannot Modify Server After Launch!" }))
                .start(undefined)
        },
        {
            label: "labelOf returns INVALID_CODE for -1 and any unregistered number",
            run: () => CTGTest.init("labelOf")
                .assert("snapshot", () => [HiveQueueServerError.labelOf(CODE.NOT_FOUND), HiveQueueServerError.labelOf(-1), HiveQueueServerError.labelOf(9999)],
                    P.equals<string[]>(["NOT_FOUND", "INVALID_CODE", "INVALID_CODE"]))
                .start(undefined)
        }
    ]
};

export default testFile;
