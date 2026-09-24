// realizes: docs/hive-queue-server-design-doc.md > Detailed Method Specifications > Route Matching; Conformance Test Cases > Routing (matcher-level cases)

// Dependencies:
import CTGTest, { CTGTestPredicates as P } from "ctg-js-test";                    // Pipeline API and predicate builders
import { HiveQueueServerError, HiveQueueServerRoute } from "../../src/index.ts";  // Class under test and its error codes
import { thrownBy } from "../support/fixtures.ts";                                // Thrown-value capture

// Type dependencies:
import type { TestFile } from "../run.ts";                                        // Manifest contract consumed by the runner

/**
 *
 * Constants
 *
 */

const { CODE } = HiveQueueServerError;

const route = (pattern: string) => HiveQueueServerRoute.init(pattern);
const entry = (method: string, pattern: string, id: string) => ({ method, route: route(pattern), id });
const codeOf = (value: unknown): number | null => HiveQueueServerError.is(value) ? value.code : null;

/**
 *
 * Manifest
 *
 */

const testFile: TestFile = {
    label: "routing",
    cases: [
        {
            label: "a literal pattern matches exactly",
            run: () => CTGTest.init("literal")
                .stage("route", () => route("/users"))
                .assert("snapshot", ({ subject: r }) => [r.match("/users") !== undefined, r.match("/users/1") !== undefined, r.match("/user") !== undefined], P.equals<boolean[]>([true, false, false]))
                .start(undefined)
        },
        {
            label: "the root pattern matches only the root path",
            run: () => CTGTest.init("root")
                .stage("route", () => route("/"))
                .assert("snapshot", ({ subject: r }) => [r.match("/") !== undefined, r.match("/a") !== undefined], P.equals<boolean[]>([true, false]))
                .start(undefined)
        },
        {
            label: "parameter segments bind by name",
            run: () => CTGTest.init("params")
                .assert("bindings", () => route("/users/:id/posts/:post").match("/users/42/posts/7"), P.equals<Record<string, string> | undefined>({ id: "42", post: "7" }))
                .start(undefined)
        },
        {
            label: "a wildcard binds the remainder under \"*\" and matches zero or more segments",
            run: () => CTGTest.init("wildcard")
                .stage("route", () => route("/files/*"))
                .assert("snapshot", ({ subject: r }) => ({ deep: r.match("/files/a/b.txt")?.["*"], empty: r.match("/files")?.["*"], other: r.match("/other") }),
                    P.equals<{ deep: string | undefined, empty: string | undefined, other: Record<string, string> | undefined }>({ deep: "a/b.txt", empty: "", other: undefined }))
                .start(undefined)
        },
        {
            label: "parameters and a wildcard combine",
            run: () => CTGTest.init("param + wildcard")
                .assert("bindings", () => route("/:bucket/*").match("/pub/x/y"), P.equals<Record<string, string> | undefined>({ bucket: "pub", "*": "x/y" }))
                .start(undefined)
        },
        {
            label: "a single trailing slash on the request path is ignored",
            run: () => CTGTest.init("trailing slash")
                .assert("snapshot", () => ({ literal: route("/a").match("/a/") !== undefined, wildcard: route("/a/*").match("/a/b/")?.["*"] }),
                    P.equals<{ literal: boolean, wildcard: string | undefined }>({ literal: true, wildcard: "b" }))
                .start(undefined)
        },
        {
            label: "invalid patterns raise INVALID_ROUTE at construction",
            run: () => CTGTest.init("invalid patterns")
                .assert("rejections", () => ["no-slash", "/a//b", "/a/*/b", "/a/", "/:", "/a*b", ""].map((p) => codeOf(thrownBy(() => route(p)))), P.equals<(number | null)[]>(Array(7).fill(CODE.INVALID_ROUTE)))
                .start(undefined)
        },
        {
            label: "isPlain is true only for literal-only patterns",
            run: () => CTGTest.init("isPlain")
                .assert("snapshot", () => [route("/pub/files").isPlain(), route("/").isPlain(), route("/pub/:x").isPlain(), route("/pub/*").isPlain()], P.equals<boolean[]>([true, true, false, false]))
                .start(undefined)
        },
        {
            label: "prefix matching implies a trailing wildcard",
            run: () => CTGTest.init("prefix")
                .stage("route", () => route("/api"))
                .assert("snapshot", ({ subject: r }) => [r.matchPrefix("/api"), r.matchPrefix("/api/thing/x"), r.matchPrefix("/other"), r.matchPrefix("/apix")], P.equals<boolean[]>([true, true, false, false]))
                .start(undefined)
        },
        {
            label: "the root prefix matches every path",
            run: () => CTGTest.init("root prefix")
                .stage("route", () => route("/"))
                .assert("snapshot", ({ subject: r }) => [r.matchPrefix("/"), r.matchPrefix("/anything/at/all")], P.equals<boolean[]>([true, true]))
                .start(undefined)
        },
        {
            label: "select returns the first registered match",
            run: () => CTGTest.init("first wins")
                .assert("id", () => HiveQueueServerRoute.select([entry("GET", "/users/:id", "param"), entry("GET", "/users/me", "literal")], "GET", "/users/me")?.entry.id, P.equals<string | undefined>("param"))
                .start(undefined)
        },
        {
            label: "select distinguishes methods, case-insensitively, and returns undefined with no match",
            run: () => CTGTest.init("methods")
                .stage("table", () => [entry("POST", "/x", "post"), entry("GET", "/x", "get")])
                .assert("snapshot", ({ subject: t }) => [HiveQueueServerRoute.select(t, "get", "/x")?.entry.id, HiveQueueServerRoute.select(t, "DELETE", "/x")?.entry.id, HiveQueueServerRoute.select(t, "GET", "/y")?.entry.id],
                    P.equals<(string | undefined)[]>(["get", undefined, undefined]))
                .start(undefined)
        },
        {
            label: "HEAD falls back to GET only when no HEAD route matches",
            run: () => CTGTest.init("HEAD fallback")
                .assert("snapshot", () => ({
                    onlyGet: HiveQueueServerRoute.select([entry("GET", "/x", "get")], "HEAD", "/x")?.entry.id,
                    both: HiveQueueServerRoute.select([entry("GET", "/x", "get"), entry("HEAD", "/x", "head")], "HEAD", "/x")?.entry.id
                }), P.equals<{ onlyGet: string | undefined, both: string | undefined }>({ onlyGet: "get", both: "head" }))
                .start(undefined)
        },
        {
            label: "select returns the params its pattern bound",
            run: () => CTGTest.init("select params")
                .assert("params", () => HiveQueueServerRoute.select([entry("GET", "/users/:id", "u")], "GET", "/users/42")?.params, P.equals<Record<string, string> | undefined>({ id: "42" }))
                .start(undefined)
        }
    ]
};

export default testFile;
