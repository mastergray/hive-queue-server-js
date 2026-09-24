// realizes: docs/hive-queue-server-design-doc.md > Conformance Test Cases > Request Class

// Dependencies:
import CTGTest, { CTGTestPredicates as P } from "ctg-js-test";                        // Pipeline API and predicate builders
import { HiveQueueServerError, HiveQueueServerRequest } from "../../src/index.ts";    // Class under test and its error codes
import HostRequestDouble from "../support/HostRequestDouble.ts";                      // Scripted host request
import { rejectedBy, thrownBy } from "../support/fixtures.ts";                        // Thrown and rejected value capture

// Type dependencies:
import type { IncomingMessage } from "node:http";                                     // Host type the double is passed as
import type { TestFile } from "../run.ts";                                            // Manifest contract consumed by the runner
import type { HiveQueueServerRouteMatch } from "../../src/index.ts";                  // Match shape init() takes

/**
 *
 * Constants
 *
 */

const { CODE } = HiveQueueServerError;
const MATCH: HiveQueueServerRouteMatch = { route: "/users/:id", params: { id: "42" } };
const ROOT: HiveQueueServerRouteMatch = { route: "/*", params: {} };

const raw = (double: HostRequestDouble): IncomingMessage => double as unknown as IncomingMessage;
const codeOf = (value: unknown): number | null => HiveQueueServerError.is(value) ? value.code : null;

/**
 *
 * Manifest
 *
 */

const testFile: TestFile = {
    label: "request class",
    cases: [
        {
            label: "init populates fields from the host request and match; body undefined",
            run: () => CTGTest.init("init")
                .stage("build", () => {
                    const host = HostRequestDouble.init({ method: "post", url: "/users/42?x=1", headers: { "x-a": "1" } });
                    return { host, request: HiveQueueServerRequest.init(raw(host), MATCH) };
                })
                .assert("snapshot", ({ subject: { host, request } }) => ({
                    method: request.method, path: request.path, route: request.route, id: request.params.id,
                    x: request.query.x, xa: request.headers["x-a"], body: request.body,
                    raw: request.raw === raw(host)
                }), P.equals<{ method: string, path: string, route: string, id: string | undefined, x: string | string[] | undefined, xa: string | undefined, body: unknown, raw: boolean }>({
                    method: "POST", path: "/users/42", route: "/users/:id", id: "42", x: "1", xa: "1", body: undefined, raw: true
                }))
                .start(undefined)
        },
        {
            label: "path is percent-decoded with the query string stripped",
            run: () => CTGTest.init("decoded path")
                .assert("path", () => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ url: "/a%20b/c?q=1" })), ROOT).path, P.equals("/a b/c"))
                .start(undefined)
        },
        {
            label: "invalid percent-encoding raises MALFORMED_PATH from parseUrl and init",
            run: () => CTGTest.init("malformed path")
                .assert("both", () => ({
                    parseUrl: codeOf(thrownBy(() => HiveQueueServerRequest.parseUrl("/a%zz"))),
                    init: codeOf(thrownBy(() => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ url: "/a%zz" })), ROOT)))
                }), P.equals<{ parseUrl: number | null, init: number | null }>({ parseUrl: CODE.MALFORMED_PATH, init: CODE.MALFORMED_PATH }))
                .start(undefined)
        },
        {
            label: "repeated query names become lists",
            run: () => CTGTest.init("query lists")
                .assert("query", () => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ url: "/?a=1&a=2&b=3" })), ROOT).query, P.equals<Record<string, string | string[]>>({ a: ["1", "2"], b: "3" }))
                .start(undefined)
        },
        {
            label: "multi-valued headers are joined with a comma and space",
            run: () => CTGTest.init("joined headers")
                .assert("value", () => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ headers: { "set-cookie": ["a=1", "b=2"] } })), ROOT).headers["set-cookie"], P.equals<string | undefined>("a=1, b=2"))
                .start(undefined)
        },
        {
            label: "header lookup is case-insensitive and undefined when absent",
            run: () => CTGTest.init("header")
                .stage("build", () => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ headers: { "content-type": "text/plain" } })), ROOT))
                .assert("snapshot", ({ subject }) => [subject.header("Content-Type"), subject.header("content-type"), subject.header("missing")], P.equals<(string | undefined)[]>(["text/plain", "text/plain", undefined]))
                .start(undefined)
        },
        {
            label: "is compares the media type ignoring parameters and case",
            run: () => CTGTest.init("is")
                .stage("build", () => HiveQueueServerRequest.init(raw(HostRequestDouble.init({ headers: { "content-type": "Application/JSON; charset=utf-8" } })), ROOT))
                .assert("snapshot", ({ subject }) => ({ json: subject.is("application/json"), text: subject.is("text/plain") }), P.equals<{ json: boolean, text: boolean }>({ json: true, text: false }))
                .start(undefined)
        },
        {
            label: "readBody parses JSON",
            run: () => CTGTest.init("json body")
                .stage("read", async () => {
                    const request = HiveQueueServerRequest.init(raw(HostRequestDouble.json('{"n":1}')), MATCH);
                    await request.readBody(1024);
                    return request.body;
                })
                .assert("body", ({ subject }) => subject, P.equals<unknown>({ n: 1 }))
                .start(undefined)
        },
        {
            label: "readBody parses URL-encoded with repeated names as lists",
            run: () => CTGTest.init("form body")
                .stage("read", async () => {
                    const body = "a=1&a=2&b=3";
                    const host = HostRequestDouble.init({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) }, body });
                    const request = HiveQueueServerRequest.init(raw(host), MATCH);
                    await request.readBody(1024);
                    return request.body;
                })
                .assert("body", ({ subject }) => subject, P.equals<unknown>({ a: ["1", "2"], b: "3" }))
                .start(undefined)
        },
        {
            label: "readBody with no declared body leaves body undefined",
            run: () => CTGTest.init("no body")
                .stage("read", async () => {
                    const request = HiveQueueServerRequest.init(raw(HostRequestDouble.init({ headers: { "content-type": "application/json" } })), MATCH);
                    await request.readBody(1024);
                    return request.body;
                })
                .assert("body", ({ subject }) => subject, P.isVoid())
                .start(undefined)
        },
        {
            label: "readBody distinguishes an empty object from no body",
            run: () => CTGTest.init("empty object")
                .stage("read", async () => {
                    const request = HiveQueueServerRequest.init(raw(HostRequestDouble.json("{}")), MATCH);
                    await request.readBody(1024);
                    return request.body;
                })
                .assert("body", ({ subject }) => subject, P.equals<unknown>({}))
                .start(undefined)
        },
        {
            label: "readBody rejects malformed JSON with MALFORMED_BODY",
            run: () => CTGTest.init("malformed json")
                .assert("code", async () => codeOf(await rejectedBy(() => HiveQueueServerRequest.init(raw(HostRequestDouble.json("{nope")), MATCH).readBody(1024))),
                    P.equals<number | null>(CODE.MALFORMED_BODY))
                .start(undefined)
        },
        {
            label: "readBody rejects a declared length over the cap with PAYLOAD_TOO_LARGE before reading",
            run: () => CTGTest.init("declared too large")
                .stage("read", async () => {
                    let read = false;
                    const host = HostRequestDouble.json('{"n":1}', { "content-length": "9999" });
                    host.on("data", () => { read = true; });
                    host.pause();
                    const code = codeOf(await rejectedBy(() => HiveQueueServerRequest.init(raw(host), MATCH).readBody(100)));
                    return { code, read };
                })
                .assert("snapshot", ({ subject }) => subject, P.equals<{ code: number | null, read: boolean }>({ code: CODE.PAYLOAD_TOO_LARGE, read: false }))
                .start(undefined)
        },
        {
            label: "readBody stops reading a chunked body once the cap is exceeded",
            run: () => CTGTest.init("chunked too large")
                .stage("read", async () => {
                    const host = HostRequestDouble.init({ method: "POST", headers: { "content-type": "application/json", "transfer-encoding": "chunked" }, body: ["{\"a\":", "1111111111", "1111111111", "}"] });
                    const code = codeOf(await rejectedBy(() => HiveQueueServerRequest.init(raw(host), MATCH).readBody(12)));
                    return { code, paused: host.isPaused() };
                })
                .assert("snapshot", ({ subject }) => subject, P.equals<{ code: number | null, paused: boolean }>({ code: CODE.PAYLOAD_TOO_LARGE, paused: true }))
                .start(undefined)
        },
        {
            label: "readBody leaves other media types unread",
            run: () => CTGTest.init("other media type")
                .stage("read", async () => {
                    let read = false;
                    const host = HostRequestDouble.init({ method: "POST", headers: { "content-type": "application/octet-stream", "content-length": "3" }, body: "abc" });
                    host.on("data", () => { read = true; });
                    host.pause();
                    const request = HiveQueueServerRequest.init(raw(host), MATCH);
                    await request.readBody(1024);
                    return { body: request.body, read };
                })
                .assert("snapshot", ({ subject }) => subject, P.equals<{ body: unknown, read: boolean }>({ body: undefined, read: false }))
                .start(undefined)
        },
        {
            label: "readBody is a no-op the second time",
            run: () => CTGTest.init("read twice")
                .stage("read", async () => {
                    const request = HiveQueueServerRequest.init(raw(HostRequestDouble.json('{"n":1}')), MATCH);
                    await request.readBody(1024);
                    await request.readBody(1024);
                    return request.body;
                })
                .assert("body", ({ subject }) => subject, P.equals<unknown>({ n: 1 }))
                .start(undefined)
        },
        {
            label: "parseUrl is exposed for route matching before a request exists",
            run: () => CTGTest.init("parseUrl")
                .assert("snapshot", () => HiveQueueServerRequest.parseUrl("/x%2Fy/z?k=v"), P.equals<{ path: string, query: Record<string, string | string[]> }>({ path: "/x/y/z", query: { k: "v" } }))
                .start(undefined)
        }
    ]
};

export default testFile;
