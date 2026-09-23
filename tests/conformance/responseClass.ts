import CTGTest from "ctg-js-test";
import CTGTestPredicates from "ctg-js-test/predicates";
import { Readable, Writable } from "node:stream";
import type { ServerResponse } from "node:http";
import { HiveQueueServerError, HiveQueueServerResponse } from "../../src/index.ts";
import { throwsHiveQueueServerError, wait } from "./helpers.ts";

// Minimal host response: a writable that records what was written:
class MockRaw extends Writable {
    status = 0;
    headers: Record<string, string> = {};
    chunks: Buffer[] = [];
    endedCount = 0;
    destroyedCount = 0;
    req: { method: string };

    constructor(method = "GET") {
        super();
        this.req = { method };
    }

    writeHead(status: number, headers: Record<string, string>): this {
        this.status = status;
        this.headers = headers;
        return this;
    }

    override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
        this.chunks.push(Buffer.from(chunk));
        cb();
    }

    override end(...args: unknown[]): this {
        this.endedCount++;
        return super.end(...(args as [])) as this;
    }

    override destroy(err?: Error): this {
        this.destroyedCount++;
        return super.destroy(err);
    }

    get body(): string {
        return Buffer.concat(this.chunks).toString();
    }
}

const make = (method = "GET") => {
    const raw = new MockRaw(method);
    let ends = 0;
    const response = new HiveQueueServerResponse(raw as unknown as ServerResponse, () => {
        ends++;
    });
    return { raw, response, ends: () => ends };
};

export default CTGTest.init("response class")
    .assert("status then end writes status and invokes onEnd once", async () => {
        const { raw, response, ends } = make();
        response.status(201).end();
        await wait(0);
        return raw.status === 201 && raw.body === "" && raw.endedCount === 1 && ends() === 1;
    }, CTGTestPredicates.isTrue())
    .assert("header then json sets header, content type, and length", async () => {
        const { raw, response } = make();
        response.header("X-A", "1").json({ ok: true });
        await wait(0);
        return raw.headers["X-A"] === "1"
            && raw.headers["Content-Type"] === "application/json"
            && raw.headers["Content-Length"] === String(Buffer.byteLength('{"ok":true}'))
            && raw.body === '{"ok":true}';
    }, CTGTestPredicates.isTrue())
    .assert("send string defaults to text/plain", async () => {
        const { raw, response } = make();
        response.send("text");
        await wait(0);
        return raw.headers["Content-Type"] === "text/plain; charset=utf-8"
            && raw.headers["Content-Length"] === "4"
            && raw.body === "text";
    }, CTGTestPredicates.isTrue())
    .assert("send bytes defaults to octet-stream", async () => {
        const { raw, response } = make();
        response.send(new Uint8Array([1, 2, 3]));
        await wait(0);
        return raw.headers["Content-Type"] === "application/octet-stream"
            && raw.headers["Content-Length"] === "3"
            && raw.chunks[0]?.length === 3;
    }, CTGTestPredicates.isTrue())
    .assert("send stream pipes and invokes onEnd when ending begins", async () => {
        const { raw, response, ends } = make();
        const stream = Readable.from(["ab", "cd"]);
        response.send(stream);
        const endsAtCall = ends();
        await wait(5);
        return endsAtCall === 1
            && raw.headers["Content-Type"] === "application/octet-stream"
            && raw.headers["Content-Length"] === undefined
            && raw.body === "abcd";
    }, CTGTestPredicates.isTrue())
    .assert("explicit content type is not overridden", async () => {
        const { raw, response } = make();
        response.header("content-type", "text/html").send("<p>");
        await wait(0);
        return raw.headers["content-type"] === "text/html" && raw.headers["Content-Type"] === undefined;
    }, CTGTestPredicates.isTrue())
    .assert("redirect sets location with default and explicit status", async () => {
        const a = make();
        a.response.redirect("/x");
        const b = make();
        b.response.redirect("/y", 301);
        await wait(0);
        return a.raw.status === 302 && a.raw.headers["Location"] === "/x" && a.raw.body === ""
            && b.raw.status === 301 && b.raw.headers["Location"] === "/y";
    }, CTGTestPredicates.isTrue())
    .assert("responded is false before ending and true after", () => {
        const { response } = make();
        const before = response.responded;
        response.end();
        return !before && response.responded;
    }, CTGTestPredicates.isTrue())
    .assert("ending twice raises ALREADY_RESPONDED and onEnd fires once", async () => {
        const { response, ends } = make();
        response.end();
        const second = throwsHiveQueueServerError(() => response.end(), HiveQueueServerError.Code.ALREADY_RESPONDED);
        const third = throwsHiveQueueServerError(() => response.json({}), HiveQueueServerError.Code.ALREADY_RESPONDED);
        await wait(0);
        return second && third && ends() === 1;
    }, CTGTestPredicates.isTrue())
    .assert("status and header after ending raise ALREADY_RESPONDED", () => {
        const { response } = make();
        response.end();
        return throwsHiveQueueServerError(() => response.status(500), HiveQueueServerError.Code.ALREADY_RESPONDED)
            && throwsHiveQueueServerError(() => response.header("X", "1"), HiveQueueServerError.Code.ALREADY_RESPONDED);
    }, CTGTestPredicates.isTrue())
    .assert("HEAD suppresses body but keeps content length", async () => {
        const { raw, response } = make("HEAD");
        response.send("hello");
        await wait(0);
        return raw.headers["Content-Length"] === "5" && raw.body === "" && raw.endedCount === 1;
    }, CTGTestPredicates.isTrue())
    .assert("stream error destroys the host response", async () => {
        const { raw, response } = make();
        const stream = new Readable({
            read() {
                this.destroy(new Error("broken"));
            }
        });
        response.send(stream);
        await wait(5);
        return raw.destroyedCount >= 1;
    }, CTGTestPredicates.isTrue());
