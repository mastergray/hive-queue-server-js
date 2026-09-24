// realizes: docs/hive-queue-server-design-doc.md > Conformance Test Cases > Response Class

// Dependencies:
import CTGTest, { CTGTestPredicates as P } from "ctg-js-test";                        // Pipeline API and predicate builders
import { Readable } from "node:stream";                                               // Stream bodies for send()
import { HiveQueueServerError, HiveQueueServerResponse } from "../../src/index.ts";   // Class under test and its error codes
import HostResponseDouble from "../support/HostResponseDouble.ts";                    // Recording host response
import { thrownBy, wait } from "../support/fixtures.ts";                              // Thrown-value capture and settling

// Type dependencies:
import type { ServerResponse } from "node:http";                                      // Host type the double is passed as
import type { TestFile } from "../run.ts";                                            // Manifest contract consumed by the runner

/**
 *
 * Constants
 *
 */

const { CODE } = HiveQueueServerError;

// Builds a response over a fresh double and counts onEnd calls:
const make = (method = "GET") => {
    const raw = new HostResponseDouble(method);
    let ends = 0;
    const response = new HiveQueueServerResponse(raw as unknown as ServerResponse, () => {
        ends++;
    });
    return { raw, response, ends: () => ends };
};

const codeOf = (value: unknown): number | null => HiveQueueServerError.is(value) ? value.code : null;

/**
 *
 * Manifest
 *
 */

const testFile: TestFile = {
    label: "response class",
    cases: [
        {
            label: "status then end writes the status with no body and invokes onEnd once",
            run: () => CTGTest.init("status/end")
                .stage("respond", async () => {
                    const r = make();
                    r.response.status(201).end();
                    await wait(0);
                    return r;
                })
                .assert("snapshot", ({ subject: { raw, ends } }) => ({ status: raw.status, body: raw.body, ended: raw.endedCount, onEnd: ends() }),
                    P.equals<{ status: number, body: string, ended: number, onEnd: number }>({ status: 201, body: "", ended: 1, onEnd: 1 }))
                .start(undefined)
        },
        {
            label: "header then json sets the header, defaults Content-Type to application/json, and sets Content-Length",
            run: () => CTGTest.init("header/json")
                .stage("respond", async () => {
                    const r = make();
                    r.response.header("X-A", "1").json({ ok: true });
                    await wait(0);
                    return r.raw;
                })
                .assert("snapshot", ({ subject }) => ({ xa: subject.headers["X-A"], type: subject.headers["Content-Type"], length: subject.headers["Content-Length"], body: subject.body }),
                    P.equals<{ xa: string | undefined, type: string | undefined, length: string | undefined, body: string }>({ xa: "1", type: "application/json", length: String(Buffer.byteLength('{"ok":true}')), body: '{"ok":true}' }))
                .start(undefined)
        },
        {
            label: "send with a string defaults Content-Type to text/plain",
            run: () => CTGTest.init("send string")
                .stage("respond", async () => {
                    const r = make();
                    r.response.send("text");
                    await wait(0);
                    return r.raw;
                })
                .assert("snapshot", ({ subject }) => ({ type: subject.headers["Content-Type"], length: subject.headers["Content-Length"], body: subject.body }),
                    P.equals<{ type: string | undefined, length: string | undefined, body: string }>({ type: "text/plain; charset=utf-8", length: "4", body: "text" }))
                .start(undefined)
        },
        {
            label: "send with bytes defaults Content-Type to application/octet-stream",
            run: () => CTGTest.init("send bytes")
                .stage("respond", async () => {
                    const r = make();
                    r.response.send(new Uint8Array([1, 2, 3]));
                    await wait(0);
                    return r.raw;
                })
                .assert("snapshot", ({ subject }) => ({ type: subject.headers["Content-Type"], length: subject.headers["Content-Length"], bytes: subject.body.length }),
                    P.equals<{ type: string | undefined, length: string | undefined, bytes: number }>({ type: "application/octet-stream", length: "3", bytes: 3 }))
                .start(undefined)
        },
        {
            label: "send with a stream pipes it and invokes onEnd when ending begins",
            run: () => CTGTest.init("send stream")
                .stage("respond", async () => {
                    const r = make();
                    r.response.send(Readable.from(["ab", "cd"]));
                    const endsAtCall = r.ends();
                    await wait(5);
                    return { raw: r.raw, endsAtCall };
                })
                .assert("snapshot", ({ subject: { raw, endsAtCall } }) => ({ endsAtCall, type: raw.headers["Content-Type"], length: raw.headers["Content-Length"], body: raw.body }),
                    P.equals<{ endsAtCall: number, type: string | undefined, length: string | undefined, body: string }>({ endsAtCall: 1, type: "application/octet-stream", length: undefined, body: "abcd" }))
                .start(undefined)
        },
        {
            label: "an explicitly set Content-Type is not overridden, matched case-insensitively",
            run: () => CTGTest.init("explicit content type")
                .stage("respond", async () => {
                    const r = make();
                    r.response.header("content-type", "text/html").send("<p>");
                    await wait(0);
                    return r.raw.headers;
                })
                .assert("snapshot", ({ subject }) => ({ lower: subject["content-type"], upper: subject["Content-Type"] }),
                    P.equals<{ lower: string | undefined, upper: string | undefined }>({ lower: "text/html", upper: undefined }))
                .start(undefined)
        },
        {
            label: "redirect sets Location with a default 302 and honors an explicit status",
            run: () => CTGTest.init("redirect")
                .stage("respond", async () => {
                    const a = make();
                    a.response.redirect("/x");
                    const b = make();
                    b.response.redirect("/y", 301);
                    await wait(0);
                    return { a: a.raw, b: b.raw };
                })
                .assert("snapshot", ({ subject: { a, b } }) => ({ aStatus: a.status, aLocation: a.headers["Location"], aBody: a.body, bStatus: b.status, bLocation: b.headers["Location"] }),
                    P.equals<{ aStatus: number, aLocation: string | undefined, aBody: string, bStatus: number, bLocation: string | undefined }>({ aStatus: 302, aLocation: "/x", aBody: "", bStatus: 301, bLocation: "/y" }))
                .start(undefined)
        },
        {
            label: "responded is false before ending and true after",
            run: () => CTGTest.init("responded")
                .assert("snapshot", () => {
                    const { response } = make();
                    const before = response.responded;
                    response.end();
                    return { before, after: response.responded };
                }, P.equals<{ before: boolean, after: boolean }>({ before: false, after: true }))
                .start(undefined)
        },
        {
            label: "any ending helper twice raises ALREADY_RESPONDED and onEnd fires once",
            run: () => CTGTest.init("ending twice")
                .stage("respond twice", async () => {
                    const r = make();
                    r.response.end();
                    const second = thrownBy(() => r.response.end());
                    const third = thrownBy(() => r.response.json({}));
                    await wait(0);
                    return { second: codeOf(second), third: codeOf(third), onEnd: r.ends() };
                })
                .assert("snapshot", ({ subject }) => subject, P.equals<{ second: number | null, third: number | null, onEnd: number }>({ second: CODE.ALREADY_RESPONDED, third: CODE.ALREADY_RESPONDED, onEnd: 1 }))
                .start(undefined)
        },
        {
            label: "status and header after ending raise ALREADY_RESPONDED",
            run: () => CTGTest.init("setters after end")
                .assert("snapshot", () => {
                    const { response } = make();
                    response.end();
                    return { status: codeOf(thrownBy(() => response.status(500))), header: codeOf(thrownBy(() => response.header("X", "1"))) };
                }, P.equals<{ status: number | null, header: number | null }>({ status: CODE.ALREADY_RESPONDED, header: CODE.ALREADY_RESPONDED }))
                .start(undefined)
        },
        {
            label: "a HEAD request gets headers and Content-Length but no body",
            run: () => CTGTest.init("HEAD")
                .stage("respond", async () => {
                    const r = make("HEAD");
                    r.response.send("hello");
                    await wait(0);
                    return r.raw;
                })
                .assert("snapshot", ({ subject }) => ({ length: subject.headers["Content-Length"], body: subject.body, ended: subject.endedCount }),
                    P.equals<{ length: string | undefined, body: string, ended: number }>({ length: "5", body: "", ended: 1 }))
                .start(undefined)
        },
        {
            label: "a stream error destroys the host response",
            run: () => CTGTest.init("stream error")
                .stage("respond", async () => {
                    const r = make();
                    r.response.send(new Readable({ read() { this.destroy(new Error("broken")); } }));
                    await wait(5);
                    return r.raw.destroyedCount;
                })
                .assert("destroyed", ({ subject }) => subject >= 1, P.isTrue())
                .start(undefined)
        },
        {
            label: "constructor rejects a non-function onEnd with INVALID_CALLBACK",
            run: () => CTGTest.init("bad onEnd")
                .assert("code", () => codeOf(thrownBy(() => new HiveQueueServerResponse(new HostResponseDouble() as unknown as ServerResponse, "nope" as never))),
                    P.equals<number | null>(CODE.INVALID_CALLBACK))
                .start(undefined)
        }
    ]
};

export default testFile;
