import CTGTest from "ctg-js-test";
import CTGTestPredicates from "ctg-js-test/predicates";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { HiveQueueServerError, HiveQueueServerRequest } from "../../src/index.ts";
import { rejectsHiveQueueServerError, throwsHiveQueueServerError } from "./helpers.ts";

// Minimal host request: a readable with method, url, and headers:
const mockRaw = (options: {
    method?: string,
    url?: string,
    headers?: Record<string, string | string[]>,
    body?: string | string[]
} = {}): IncomingMessage => {
    const chunks = options.body === undefined ? [] : Array.isArray(options.body) ? options.body : [options.body];
    const raw = Readable.from(chunks.map((c) => Buffer.from(c))) as unknown as IncomingMessage;
    (raw as { method: string }).method = options.method ?? "GET";
    (raw as { url: string }).url = options.url ?? "/";
    (raw as { headers: unknown }).headers = options.headers ?? {};
    return raw;
};

const jsonRaw = (body: string, extra: Record<string, string> = {}) => mockRaw({
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...extra },
    body
});

const match = { route: "/users/:id", params: { id: "42" } };

export default CTGTest.init("request class")
    .assert("init populates fields from the host request and match", () => {
        const raw = mockRaw({ method: "post", url: "/users/42?x=1", headers: { "x-a": "1" } });
        const request = HiveQueueServerRequest.init(raw, match);
        return request.method === "POST"
            && request.path === "/users/42"
            && request.route === "/users/:id"
            && request.params.id === "42"
            && request.query.x === "1"
            && request.headers["x-a"] === "1"
            && request.body === undefined
            && Object.keys(request.locals).length === 0
            && request.raw === raw;
    }, CTGTestPredicates.isTrue())
    .assert("path is percent-decoded and query stripped", () => {
        const request = HiveQueueServerRequest.init(mockRaw({ url: "/a%20b/c?q=1" }), { route: "/*", params: {} });
        return request.path === "/a b/c";
    }, CTGTestPredicates.isTrue())
    .assert("malformed percent-encoding raises MALFORMED_PATH", () => {
        return throwsHiveQueueServerError(
            () => HiveQueueServerRequest.parseUrl("/a%zz"),
            HiveQueueServerError.Code.MALFORMED_PATH
        ) && throwsHiveQueueServerError(
            () => HiveQueueServerRequest.init(mockRaw({ url: "/a%zz" }), { route: "/*", params: {} }),
            HiveQueueServerError.Code.MALFORMED_PATH
        );
    }, CTGTestPredicates.isTrue())
    .assert("repeated query names become lists", () => {
        const request = HiveQueueServerRequest.init(mockRaw({ url: "/?a=1&a=2&b=3" }), { route: "/", params: {} });
        return Array.isArray(request.query.a)
            && (request.query.a as string[]).join(",") === "1,2"
            && request.query.b === "3";
    }, CTGTestPredicates.isTrue())
    .assert("multi-valued headers are joined", () => {
        const request = HiveQueueServerRequest.init(mockRaw({ headers: { "set-cookie": ["a=1", "b=2"] } }), { route: "/", params: {} });
        return request.headers["set-cookie"] === "a=1, b=2";
    }, CTGTestPredicates.isTrue())
    .assert("header lookup is case-insensitive", () => {
        const request = HiveQueueServerRequest.init(mockRaw({ headers: { "content-type": "text/plain" } }), { route: "/", params: {} });
        return request.header("Content-Type") === "text/plain"
            && request.header("content-type") === "text/plain"
            && request.header("missing") === undefined;
    }, CTGTestPredicates.isTrue())
    .assert("is compares the media type ignoring parameters and case", () => {
        const request = HiveQueueServerRequest.init(mockRaw({ headers: { "content-type": "Application/JSON; charset=utf-8" } }), { route: "/", params: {} });
        return request.is("application/json") && !request.is("text/plain");
    }, CTGTestPredicates.isTrue())
    .assert("readBody parses JSON", async () => {
        const request = HiveQueueServerRequest.init(jsonRaw('{"n":1}'), match);
        await request.readBody(1024);
        return (request.body as { n: number }).n === 1;
    }, CTGTestPredicates.isTrue())
    .assert("readBody parses URL-encoded with repeated names as lists", async () => {
        const body = "a=1&a=2&b=3";
        const raw = mockRaw({
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) },
            body
        });
        const request = HiveQueueServerRequest.init(raw, match);
        await request.readBody(1024);
        const parsed = request.body as Record<string, string | string[]>;
        return Array.isArray(parsed.a) && parsed.a.join(",") === "1,2" && parsed.b === "3";
    }, CTGTestPredicates.isTrue())
    .assert("readBody with no body leaves body undefined", async () => {
        const request = HiveQueueServerRequest.init(mockRaw({ headers: { "content-type": "application/json" } }), match);
        await request.readBody(1024);
        return request.body === undefined;
    }, CTGTestPredicates.isTrue())
    .assert("readBody distinguishes an empty object from no body", async () => {
        const request = HiveQueueServerRequest.init(jsonRaw("{}"), match);
        await request.readBody(1024);
        return typeof request.body === "object" && request.body !== null && Object.keys(request.body as object).length === 0;
    }, CTGTestPredicates.isTrue())
    .assert("readBody rejects malformed JSON with MALFORMED_BODY", async () => {
        const request = HiveQueueServerRequest.init(jsonRaw("{nope"), match);
        return rejectsHiveQueueServerError(() => request.readBody(1024), HiveQueueServerError.Code.MALFORMED_BODY);
    }, CTGTestPredicates.isTrue())
    .assert("readBody rejects a declared length over the cap before reading", async () => {
        let read = false;
        const raw = jsonRaw('{"n":1}', { "content-length": "9999" });
        raw.on("data", () => {
            read = true;
        });
        raw.pause();
        const request = HiveQueueServerRequest.init(raw, match);
        const rejected = await rejectsHiveQueueServerError(() => request.readBody(100), HiveQueueServerError.Code.PAYLOAD_TOO_LARGE);
        return rejected && !read;
    }, CTGTestPredicates.isTrue())
    .assert("readBody stops reading a chunked body once the cap is exceeded", async () => {
        const chunks = ["{\"a\":", "1111111111", "1111111111", "}"];
        const raw = mockRaw({
            method: "POST",
            headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
            body: chunks
        });
        const request = HiveQueueServerRequest.init(raw, match);
        const rejected = await rejectsHiveQueueServerError(() => request.readBody(12), HiveQueueServerError.Code.PAYLOAD_TOO_LARGE);
        return rejected && raw.isPaused();
    }, CTGTestPredicates.isTrue())
    .assert("readBody leaves other media types unread", async () => {
        let read = false;
        const raw = mockRaw({
            method: "POST",
            headers: { "content-type": "application/octet-stream", "content-length": "3" },
            body: "abc"
        });
        raw.on("data", () => {
            read = true;
        });
        raw.pause();
        const request = HiveQueueServerRequest.init(raw, match);
        await request.readBody(1024);
        return request.body === undefined && !read;
    }, CTGTestPredicates.isTrue())
    .assert("readBody is a no-op the second time", async () => {
        const request = HiveQueueServerRequest.init(jsonRaw('{"n":1}'), match);
        await request.readBody(1024);
        await request.readBody(1024);
        return (request.body as { n: number }).n === 1;
    }, CTGTestPredicates.isTrue())
    .assert("parseUrl is exposed for route matching", () => {
        const { path, query } = HiveQueueServerRequest.parseUrl("/x%2Fy/z?k=v");
        return path === "/x/y/z" && query.k === "v";
    }, CTGTestPredicates.isTrue());
