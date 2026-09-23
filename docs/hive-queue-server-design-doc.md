# Hive Queue Server — Language-Agnostic Design Document

## Purpose

This document describes the design of a minimal HTTP server built on
top of Hive Queue. Every request becomes a task, every stage of
handling a request is a worker, and routes and middleware bind HTTP
entry points to handlers. The server owns the concerns the queue
deliberately leaves out — per-request failure isolation, per-request
deadlines, admission by depth, and lifecycle — without changing the
queue's contract underneath.

The document captures behavior, contracts, and error semantics without
reference to a specific language runtime. The reference implementation
targets Node's native HTTP module with no runtime dependency other
than Hive Queue.

This design depends on Hive Queue design v2 (concurrent processing,
`protected pump`). Where this document says "the queue", it means an
instance conforming to that design.

---

## API Contract Table

Everything listed here is required. Nothing unlisted should be
implemented.

### Required — Server

| Method | Description |
|--------|-------------|
| `init` (static factory) | Create a server instance from an optional config |
| Constructor | Create a server instance from an optional config |
| `worker` | Bind a worker ID to a worker function |
| `use` | Append a handler to the middleware list, optionally path-scoped |
| `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD` | Bind a method and path pattern to a handler |
| `static` | Serve files under a directory for a path prefix |
| `chain` | Merge another instance's workers, middleware, routes, and mounts into this one |
| `onHalt` | Set the callback invoked when the server has stopped |
| `launch` | Register inline handlers, validate wiring, freeze it, and begin listening |
| `close` | Stop accepting requests, drain, halt the queue, and stop listening |

### Required — Worker Context

A worker registered with `worker(id, fn)` receives the Hive Queue
worker context with the server's proxies substituted. No fields are
added:

| Field | Description |
|-------|-------------|
| `task` | The task; `task.data` is whatever the sender sent |
| `send` | Delegate to another registered worker; proxied |
| `done` | Complete the current task; proxied |
| `halt` | Stop the server; proxied |
| `getEnv` | Read the shared environment; proxied |
| `setEnv` | Replace the shared environment; proxied |

### Required — Handler Context

A handler bound by `use` or a verb receives everything a worker does,
plus two fields:

| Field | Description |
|-------|-------------|
| `task` | The task; `task.data` is the request object |
| `request` | The request object (same reference as `task.data`) |
| `response` | The response object for this request |
| `send` | Delegate to a registered worker; proxied |
| `done` | Complete the current task; in a middleware stage, also forward the request; proxied |
| `halt` | Stop the server; proxied |
| `getEnv` | Read the shared environment; proxied |
| `setEnv` | Replace the shared environment; proxied |

### Required — Request Class

| Member | Description |
|--------|-------------|
| Static factory | Build a request from a host request and a route match |
| `method`, `path`, `route`, `params`, `query`, `headers`, `body`, `locals`, `raw` | Parsed request fields |
| `header` | Case-insensitive header lookup |
| `is` | Content-type check |
| `readBody` | Read and parse the body with a size cap |

### Required — Response Class

| Member | Description |
|--------|-------------|
| Constructor | Wrap a host response with an on-end callback |
| `status`, `header` | Set pending status and headers; chainable |
| `json`, `send`, `redirect`, `end` | Write and end the response |
| `responded` | Whether the response has ended |
| `raw` | The host response object |

### Required — Error Class

| Member | Description |
|--------|-------------|
| Constructor | Create an error from a code, category, message, and HTTP status |
| Per-condition factories (static) | One named constructor per canonical condition |
| `Code` (static) | Constant map from condition name to numeric code |
| `is` (static) | Type guard for instances of the class |
| `log` | Write the error to standard error, optionally through a formatter |
| `statusCode` | HTTP status the error maps to when sent as a response |

### Compatibility Policy

New language implementations target this design document only. If a
method or config key is not in this document, it does not exist.

---

## Core Concepts

### 1. The Server Is a Queue

A server instance owns one queue, constructed active with concurrent
processing enabled. `start` is never called. The listener drives the
queue entirely through `send`, one task per admitted request, and the
queue's pump dispatches on arrival. All behavior lives in workers
registered on that queue.

### 2. Routes Bind Handlers

A route or middleware entry binds either an inline handler function
or the ID of a worker registered with `worker(id, fn)`. Inline
handlers are registered on the queue at launch under namespaced IDs
the server generates, so binding them creates nothing until launch.
This is what makes `chain` a concatenation: two instances with inline
handlers merge without any ID coordination. The ID form exists for a
worker that serves several routes or is also a delegation target.

### 3. Every Stage Is a Worker

A request passes through the middleware list in order, then reaches
its route's handler. Each stage is a task; moving to the next stage
is a `send` to the next worker, performed by the wrapper when a stage
calls `done()`. The built-in body parser is always the first stage.
Consequences:

- **Concurrency counts executing stages, not requests.** A request
  between stages is in the task list, not in a slot.
- **FIFO across stages is a fairness property.** Pending stages of
  earlier requests dispatch before the first stage of later ones.
- **Each stage is a deferred dispatch.** A request with M middleware
  stages pays M+2 scheduler turns before its route handler runs.

### 4. Completion Is Always `done()`

Handlers and workers complete a task in exactly one way: by calling
`done()` (or `halt`). Ending the HTTP response does not complete a
task, and a function returning does not complete a task. This is the
queue's continuation contract, unchanged. Two things follow:

- **A handler that responds also calls `done()`.** Responding and
  completing are separate acts on separate objects.
- **A handler that delegates the response calls `done()` after
  `send`.** The worker it delegated to ends the response and calls its
  own `done()`. Three completions — the handler's task, the HTTP
  request, the worker's task — each explicit.

In a middleware stage, `done()` additionally forwards the request to
the next stage, unless the stage has already responded, in which case
the pipeline ends there. In a route handler it simply completes.

### 5. The Response Object Owns the HTTP Response

The response object wraps the host response and writes to it. It
carries pending status and headers, and its ending helpers write them
with a body and end the host response, which flushes to the client. It
knows nothing about tasks. A handler can place it in the data it sends
to a worker, and that worker ends the response through the same
object. When the response ends, an on-end callback installed by the
listener clears the request's deadline and releases its admission.

### 6. The Wrapper Owns the Queue's Guards

Every function registered on the queue — inline handler, ID-bound
handler, or worker — is wrapped. The wrapper proxies every task-scoped
operation and checks its own completion state first, so the queue's
lifecycle guards (`DONE_AFTER_DONE` and siblings) are never raised for
a server function. A misuse becomes a typed server error raised into
the function, which the wrapper catches. The queue's error convergence
on halt is therefore reachable only through the proxied `halt` and
through a bug in the server itself.

### 7. Failure Is Per Request

A handler throwing, delegating to an unknown worker, or misusing the
context produces a response for that request (if none has been sent)
and frees its slot. No other request is affected. A worker throwing
frees its slot and is reported; the server cannot respond on its
behalf because a worker's task data is opaque. The halt handler is
not a request failure path; it is a shutdown path and, as a safety
net, a recovery path.

### 8. Deadlines Are Per Request, With Two Duties

Each admitted request has one deadline, armed at admission, covering
queue wait and every stage. When it fires:

- if no response has been sent, the server responds 504 on the
  request's behalf
- if the request's current handler task has not been completed, the
  server completes it and reports the defect

The second duty bounds a slot leaked by a handler that responded but
never called `done()`. The timer is independent of the queue, so it
also bounds requests orphaned by a halt.

### 9. Admission Is Bounded by Requests, Not Tasks

`maxPending` limits the number of admitted requests: those that have
entered the server and not yet responded. It is checked at the
listener before any task exists. Internal delegation is never subject
to it, which is the distinction the queue's caller sentinel exists to
make.

### 10. Halt Means Stop the Server

A handler or worker calling `halt(value)` asks for the run to end, and
in a server the run is the service. The proxied `halt` responds to the
current request if needed and begins the same shutdown `close`
performs.

---

## Data Structures

**Config**:

```
{
  port?:          int         (default 3000; 0 means OS-assigned)
  host?:          string      (default undefined; all interfaces)
  concurrency?:   int         (default 32; passed to the queue)
  timeout?:       int ms      (default 30000; per-request deadline)
  maxPending?:    int         (default undefined; unbounded)
  maxBodySize?:   int bytes   (default 1048576)
  drainTimeout?:  int ms      (default 10000)
  retryAfter?:    int seconds (default 1; sent on 503)
  recover?:       bool        (default true)
  cors?:          CorsConfig  (default undefined; CORS off)
  headers?:       HeadersConfig | false  (default undefined; all defaults on)
  env?:           any         (passed to the queue)
  onHalt?:        (value) -> void            (asynchronous)
  onError?:       (error, request?) -> void  (default: log to standard error)
}
```

**CorsConfig**:

```
{
  origin:          string | string[] | (origin) -> bool | "*"
  methods?:        string[]      (default: all verbs the server supports)
  allowedHeaders?: string[]      (default: reflect the preflight request)
  exposedHeaders?: string[]      (default: none)
  credentials?:    bool          (default false)
  maxAge?:         int seconds   (default undefined; header omitted)
}
```

**HeadersConfig**: a map from header name to `true` (default value),
`false` (omit), or a string (explicit value). Content-Security-Policy
additionally accepts a map from directive name to a list of sources.

**Handler**: `handlerFn(context) -> void` — asynchronous; context per
the Handler Context table.

**Worker**: `workerFn(context) -> void` — asynchronous; context per
the Worker Context table.

**Route entry**: `{ method: string, pattern: string, handler: string | handlerFn }`

**Middleware entry**: `{ pattern?: string, handler: string | handlerFn }`

**Static mount**: `{ prefix: string, dir: string }`

**Server error**:
`{ name, code: int, category: string, message: string, statusCode: int }`
— extends the host's native error type.

---

## Detailed Method Specifications

### `init(config?) -> server` (static factory)

Creates and returns a new server, defaulting the config to an empty
structure. This is the chainable entry point.

### Constructor: `new(config?) -> server`

1. Validate config (see Validation Rules). Each failure raises the
   corresponding configuration error to the caller.
2. Construct the queue with
   `{ isActive: true, concurrent: true, concurrency, env, onHalt }`
   where `onHalt` is the server's own halt handler (see Halt
   Handler), not the user's callback.
3. Initialize empty worker, middleware, route, and mount registries;
   an admitted-request count of zero; `closing` false; `launched`
   false.

### `worker(id, fn) -> self`

1. If launched, raise `LAUNCHED`
2. Wrap `fn` as a worker (see Worker Wrapper) and register the
   wrapped function with the queue under `id`. A duplicate ID raises
   the queue's own `WORKER_ALREADY_BOUND` to the caller.
3. Return the server

### `use(handler) -> self` and `use(pattern, handler) -> self`

1. If launched, raise `LAUNCHED`
2. If `pattern` is given and is not a valid pattern, raise
   `INVALID_ROUTE`
3. If `handler` is neither a string nor a function, raise
   `INVALID_HANDLER`
4. Append `{ pattern?, handler }` to the middleware list
5. Return the server

A string handler is validated against the registry at launch. A
function handler is registered at launch.

### `GET(pattern, handler) -> self` and the other verbs

1. If launched, raise `LAUNCHED`
2. If `pattern` is not a valid pattern, raise `INVALID_ROUTE`
3. If `handler` is neither a string nor a function, raise
   `INVALID_HANDLER`
4. If a route with the same method and pattern exists, raise
   `DUPLICATE_ROUTE`
5. Append `{ method, pattern, handler }` to the route list
6. Return the server

Supported verbs: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`,
`HEAD`.

### `static(prefix, dir) -> self`

1. If launched, raise `LAUNCHED`
2. If `prefix` is not a valid pattern or contains a parameter or
   wildcard, raise `INVALID_ROUTE`
3. Record a mount `{ prefix, dir }`. At launch, the server registers
   a built-in static handler for the mount and binds it to `GET` and
   `HEAD` on `prefix + "/*"`.
4. Return the server

### `chain(other) -> self`

1. If launched, raise `LAUNCHED`
2. For each worker in `other`, register it here under the same ID
   (a collision raises `WORKER_ALREADY_BOUND`)
3. Append `other`'s middleware entries after this instance's own
4. Append `other`'s route entries after this instance's own; a
   duplicate method and pattern raises `DUPLICATE_ROUTE`
5. Append `other`'s mounts
6. Return the server

Inline handlers in `other` are entries, not registered workers, so
they carry over with no ID coordination.

### `onHalt(fn) -> self`

Replaces the user's halt callback. The last one set wins. It is
invoked by the server's halt handler on shutdown, never on recovery.

### `launch(cb?) -> void` (asynchronous)

1. If launched, raise `LAUNCHED`
2. Register built-in handlers: the body parser stage, and one static
   handler per mount, under namespaced IDs (`hive:body`,
   `hive:static:<prefix>`)
3. Register inline handlers: for each middleware entry whose handler
   is a function, register it wrapped as a handler under
   `hive:use:<index>`; for each route entry whose handler is a
   function, under `hive:route:<METHOD>:<pattern>`. Replace the
   entry's handler with the generated ID.
4. Validate wiring: every middleware entry's ID must be registered
   (`UNKNOWN_MIDDLEWARE_WORKER`); every route entry's ID must be
   registered (`UNKNOWN_ROUTE_WORKER`)
5. Build the pipeline: the ordered list of stage IDs, with the parser
   first, followed by middleware entries in order. Record, for each
   stage ID, its successor (the next stage ID, or the marker meaning
   "the matched route").
6. Set `launched` true; from here `worker`, `use`, the verbs,
   `static`, and `chain` raise `LAUNCHED`
7. Create the host HTTP server, attach the Listener, and listen on
   `host` and `port`
8. Resolve once listening. If `cb` is given, invoke it with the
   server. The server exposes the bound port.

Step 3 is why ID-bound and inline handlers behave identically after
launch: both are worker IDs by the time the pipeline exists.

### `close() -> void` (asynchronous)

1. If not launched, or already closing, do nothing and return
2. Set `closing` true
3. Stop accepting new connections. Requests arriving on existing
   connections are answered 503 with `Connection: close` at the
   Listener and are not admitted.
4. Wait until the admitted-request count is zero or `drainTimeout`
   elapses. At the timeout, every request still admitted is responded
   503 through its response object, and its current handler task, if
   any, is completed.
5. Halt the queue with the shutdown value. The handler sees `closing`
   and invokes the user's `onHalt` callback.
6. Close the host server and resolve.

### Listener (internal)

Invoked by the host for every incoming request:

1. Apply security headers to the host response (see Security Headers)
2. If the request is a CORS preflight, answer it (see CORS) and
   return; no task, no admission
3. If `closing`, respond 503 with `Retry-After` and
   `Connection: close`; return
4. If `maxPending` is set and the admitted count equals it, respond
   503 with `Retry-After`; return
5. Match the route (see Route Matching). No match responds 404 and
   returns; no admission.
6. Build the request object from the host request and the match (see
   Request Class). `body` is undefined.
7. Build the response object around the host response, with an
   on-end callback that clears the deadline and decrements the
   admitted count (see Response Class)
8. Apply CORS response headers if the origin matches (see CORS)
9. Increment the admitted count; arm the deadline (see Deadline)
10. Send the first task: `{ to: <first pipeline stage>, data: request }`
    with the caller sentinel as `from`. The queue is active and
    concurrent, so this requests a pump.

The listener keeps, per request, a record `{ request, response,
deadline, currentCompletion }`, keyed by the request object. Steps
3–5 write responses directly and never touch the queue.

### Route Matching (internal)

A pattern is a path of `/`-separated segments. A segment is a
literal, a parameter (`:name`), or a trailing wildcard (`*`, last
segment only). Matching:

1. Split the request path and the pattern into segments
2. Literal segments must be equal; parameter segments bind the
   request segment under `name`; a wildcard binds the remainder
   (joined with `/`) under `"*"` and matches zero or more segments
3. Routes are tried in registration order; the first match wins
4. `HEAD` requests with no `HEAD` route fall back to a matching `GET`
   route; the response body is suppressed

Path-scoped middleware uses the same matcher against its pattern with
a trailing wildcard implied (prefix match).

### Handler Wrapper (internal)

Every handler — inline, ID-bound, or built-in — is registered on the
queue as a wrapper that, on each dispatch:

1. Let `request = task.data` and look up the request's record. If
   `response.responded` is already true (the deadline or drain fired
   while this task was pending), call the queue's `done` and return
   without invoking the handler.
2. If this stage is path-scoped and the request path does not match,
   forward (as in step 3's `done`) and return without invoking the
   handler.
3. Create `complete`, which calls the queue's `done` at most once and
   clears the record's `currentCompletion`. Store it as the record's
   `currentCompletion`. Build the proxied context:
   - `task`: the queue's task
   - `request`, `response`: from the record
   - `send(id, data)`: if completed, raise `SEND_AFTER_DONE`; if `id`
     is not registered, raise `UNKNOWN_DELEGATE`; otherwise enqueue
     `{ from: <this handler's ID>, to: id, data }` via the queue's
     `send`. `data` is sent exactly as given.
   - `done()`: if completed, raise `DONE_AFTER_DONE`; otherwise, if
     this stage has a successor **and the response has not ended**,
     enqueue `{ from: <this ID>, to: <successor or matched route ID>,
     data: request }`; then call `complete`. A stage that has
     responded therefore completes without forwarding: responding is
     how middleware ends the pipeline.
   - `halt(value)`: if completed, raise `DONE_AFTER_DONE`; if not
     responded, respond 503; call `complete`; invoke the server's
     `close` with `value`
   - `getEnv()` / `setEnv(updater)`: if completed, raise
     `ENV_AFTER_DONE`; otherwise pass through (the queue's
     `INVALID_ENV` still applies, raised into the handler unchanged)
4. Invoke the handler with the proxied context and wait for it
5. On a thrown value: if not responded, respond with it (see Error
   Responses); invoke `onError` with it and the request if it was
   not a server error with a status, or if the response had already
   ended; then call `complete`
6. On normal return, do nothing. Completion is the handler's
   responsibility through `done()`; a handler that never calls it
   holds its slot until the deadline's second duty.

The successor of the last middleware stage is the request's matched
route ID, recorded on the request at admission. A route handler has
no successor, so its `done()` only completes.

### Worker Wrapper (internal)

Every worker registered with `worker(id, fn)` is registered on the
queue as a wrapper that, on each dispatch:

1. Create `complete`, which calls the queue's `done` at most once
2. Build the proxied context:
   - `task`: the queue's task, unchanged
   - `send(id, data)`: if completed, raise `SEND_AFTER_DONE`; if `id`
     is not registered, raise `UNKNOWN_DELEGATE`; otherwise enqueue
     via the queue's `send`
   - `done()`: if completed, raise `DONE_AFTER_DONE`; otherwise call
     `complete`
   - `halt(value)`: if completed, raise `DONE_AFTER_DONE`; call
     `complete`; invoke `close` with `value`
   - `getEnv()` / `setEnv(updater)`: if completed, raise
     `ENV_AFTER_DONE`; otherwise pass through
3. Invoke the worker and wait for it
4. On a thrown value: invoke `onError` with it (no request is known);
   call `complete`
5. On normal return, do nothing

The server cannot respond on a worker's behalf because it does not
know whether the worker's task data holds a response. If the worker
was given one and throws before using it, the request's deadline
sends the 504.

### Request Class

**Static factory** `from(rawRequest, match) -> request`:

1. `method`: upper-cased host method
2. `path`: the URL path, percent-decoded, without the query string
3. `route`: the matched pattern; `params`: the match bindings, decoded
4. `query`: parsed from the query string; repeated names become
   lists
5. `headers`: host headers with lower-case names
6. `locals`: an empty structure
7. `body`: undefined
8. `raw`: the host request

**`header(name) -> string | undefined`**: case-insensitive lookup.

**`is(type) -> bool`**: whether the `Content-Type` header's media
type equals `type`.

**`readBody(maxBytes) -> void`** (asynchronous):

1. If the request has no body (no `Content-Length` and no chunked
   encoding), set nothing and return
2. If the media type is not `application/json` or
   `application/x-www-form-urlencoded`, set nothing and return
   without consuming the stream
3. Read the stream, counting bytes. Exceeding `maxBytes` stops
   reading and raises `PAYLOAD_TOO_LARGE`
4. Parse by media type. A JSON parse failure raises
   `MALFORMED_BODY`. URL-encoded bodies parse into a map, repeated
   names becoming lists.
5. Set `body`

`readBody` is what the built-in parser stage calls. A handler for
another content type may read `raw` directly.

### Response Class

**Constructor** `new(rawResponse, onEnd)`:

- `responded` false; pending status 200; pending headers empty;
  `raw` the host response

**`status(code) -> self`**: set the pending status. After `responded`,
raise `ALREADY_RESPONDED`.

**`header(name, value) -> self`**: set a pending header. After
`responded`, raise `ALREADY_RESPONDED`.

**`json(value) -> void`**: serialize `value`; set `Content-Type` to
`application/json` and `Content-Length` unless already set; then end.

**`send(body) -> void`**: a string sets `Content-Type` to
`text/plain; charset=utf-8` unless already set; a byte buffer sets
`application/octet-stream` unless already set; a readable stream is
piped. Then end.

**`redirect(url, status?) -> void`**: set `Location`, status (default
302), then end with no body.

**`end() -> void`**: end with no body.

**Ending** (shared by the four above):

1. If `responded`, raise `ALREADY_RESPONDED`
2. Write the pending status and headers to `raw`
3. Write the body (or begin piping) and end `raw`
4. Set `responded` true
5. Invoke `onEnd` once

For a `HEAD` request the body is suppressed but `Content-Length`
reflects what `GET` would have sent.

### Deadline (internal)

Armed at admission with the configured `timeout`. When it fires:

1. If not responded, respond 504 through the response object. This
   ends the response, which clears the deadline record and decrements
   the admitted count.
2. If the record has a `currentCompletion`, call it and invoke
   `onError` with `TASK_NOT_COMPLETED` and the request. The task is
   completed on the handler's behalf; its slot is freed.

Step 2 runs regardless of step 1. A request that responded but whose
handler never called `done()` reaches step 2 alone. The timer does
not consult the queue's active flag.

### Halt Handler (internal)

Installed on the queue at construction. Receives the halt value:

1. If `closing`: invoke the user's `onHalt` callback with the value
   and return. Shutdown is already underway.
2. Otherwise this is an escaped failure — something reached the
   queue's halt path that the wrappers should have caught:
   - If `recover` is false: set `closing`, invoke `onError` with the
     value, and run the `close` sequence with the value as the
     shutdown value
   - If `recover` is true: invoke `onError` with the value, marked as
     a recovery event; set the queue active; reset its in-flight
     count to zero; request a pump. Pending tasks resume. Requests in
     a handler at the moment of halt are orphans in the queue's
     sense; their responses still go out if sent, and the deadline
     bounds the rest.

Recovery is a safety net, not a request-failure path. A recovery
event indicates a server bug.

### Body Parser (built-in stage)

Always the first pipeline stage, registered at launch as `hive:body`.
It is a handler:

1. Call `request.readBody(maxBodySize)` and let any error propagate
2. Call `done()` to forward

A `PAYLOAD_TOO_LARGE` or `MALFORMED_BODY` raised by `readBody` is
caught by the handler wrapper, which responds with it and completes
the task. Nothing forwards, so the route handler never runs. The
parser has no error handling of its own.

### Static Handler (built-in)

One per mount, registered at launch and bound to `GET` and `HEAD` on
`prefix + "/*"`. It is a handler:

1. Join `params["*"]` onto `dir`, normalize, and verify the result is
   within `dir`. Outside raises `NOT_FOUND`.
2. If the path is a directory, use `index.html` inside it; if absent,
   raise `NOT_FOUND`
3. If the file does not exist or is not readable, raise `NOT_FOUND`
4. If `If-Modified-Since` is present and not older than the file's
   modification time, respond 304 and call `done()`
5. Set `Content-Type` from the extension table (fallback
   `application/octet-stream`), `Content-Length`, and `Last-Modified`
6. For `HEAD`, end with headers only. For `GET`, `send` the file as
   a stream. Call `done()` once streaming has begun.
7. A stream error after headers are sent cannot be reported; close
   the connection and invoke `onError` with `STREAM_FAILED`

The extension table is exported and extensible. No directory
listings, ranges, or compression.

### CORS (internal)

Active only when `cors` is configured.

**Origin check**: a string matches exactly; a list matches any
member; a predicate is called with the origin; `"*"` matches any
origin and emits the literal `*`.

**Preflight** — a request with method `OPTIONS` and an
`Access-Control-Request-Method` header:

1. If the origin does not match, respond 204 with no CORS headers
2. Otherwise respond 204 with `Access-Control-Allow-Origin`,
   `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`
   (configured list, or reflected from the request), and, when set,
   `Access-Control-Allow-Credentials` and `Access-Control-Max-Age`
3. Add `Vary: Origin` unless the origin is `"*"`

Preflights are answered at the Listener. They create no task and do
not count toward `maxPending`.

**Admitted requests** whose origin matches receive
`Access-Control-Allow-Origin` and, when configured,
`Access-Control-Allow-Credentials` and
`Access-Control-Expose-Headers`, set as pending headers on the
response object before the first task is sent. Handlers may override
them. Non-matching origins receive no CORS headers and are otherwise
served normally.

An `OPTIONS` request without `Access-Control-Request-Method` is an
ordinary request and may have a route.

### Security Headers (internal)

Applied at the Listener to every response the server writes,
including preflights and rejections, before any task exists. For
admitted requests they are pending headers on the response object, so
handlers may override any of them.

Defaults (Helmet's defaults at the time of writing):

| Header | Default |
|--------|---------|
| `Content-Security-Policy` | `default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` |

`Cross-Origin-Embedder-Policy` is not emitted unless configured with
an explicit value. `headers: false` disables the entire set. A
`Content-Security-Policy` given as a directive map is serialized as
`name source source;name source`.

Documented interactions, not automated: `Cross-Origin-Resource-Policy:
same-origin` blocks cross-origin embedding even when CORS allows
fetching, so a server configured for cross-origin use usually sets it
to `cross-origin`; `Strict-Transport-Security` is ignored by browsers
over plain HTTP and is emitted for the benefit of a TLS terminator.

### Error Responses (internal)

When a handler wrapper responds with a thrown value:

- A server error with a status: that status, JSON body
  `{ "error": { "message": <message>, "code": <code> } }`
- A server error without a status, a queue error, or anything else:
  status 500, JSON body
  `{ "error": { "message": "Internal Server Error", "code": <INTERNAL> } }`;
  `onError` receives the original

Built-in rejections (404, 413, 400, 503, 504) use the server error
form with the corresponding condition's code.

### Error Class

**Constructor**: `new(code, category, message, statusCode?, options?)`

**Per-condition factories (static)**:

```
INVALID_PORT()                 INVALID_TIMEOUT()
INVALID_CONCURRENCY()          INVALID_MAX_PENDING()
INVALID_MAX_BODY_SIZE()        INVALID_DRAIN_TIMEOUT()
INVALID_RETRY_AFTER()          INVALID_CORS(reason)
INVALID_HEADERS(name)

UNKNOWN_ROUTE_WORKER(id)       UNKNOWN_MIDDLEWARE_WORKER(id)
INVALID_ROUTE(pattern)         INVALID_HANDLER()
DUPLICATE_ROUTE(method, pattern)
LAUNCHED()

SEND_AFTER_DONE()              DONE_AFTER_DONE()
ENV_AFTER_DONE()               ALREADY_RESPONDED()
UNKNOWN_DELEGATE(id)

NOT_FOUND()                    PAYLOAD_TOO_LARGE()
MALFORMED_BODY()               SERVICE_UNAVAILABLE()
GATEWAY_TIMEOUT()              INTERNAL(cause?)
HTTP(statusCode, message)

STREAM_FAILED(cause?)          TASK_NOT_COMPLETED()
```

`HTTP(statusCode, message)` is the factory a handler uses to throw a
deliberate HTTP error; its code is the single `HTTP` condition and
its status is whatever was given.

**`Code`** and **`is`** as in Hive Queue's error class.

**`log(formatter?) -> void`**: writes the error to standard error.
Without a formatter, the output is `[category:code:status] message`,
with status omitted when the condition has none. A formatter has the
signature `formatter(message, code, category, statusCode) -> string`,
where `statusCode` is undefined for conditions without one. This is
the queue's formatter signature with the status appended, so a
formatter written for queue errors is usable unchanged.

The server error class does not extend the queue's. The two share a
shape, not an ancestry: `HiveQueueError.is` is false for server
errors, and the wrapper relies on that distinction.

---

## Validation Rules

| Rule | Error |
|------|-------|
| `port` is an integer in 0–65535 | `INVALID_PORT` |
| `timeout`, `drainTimeout` are positive integers | `INVALID_TIMEOUT`, `INVALID_DRAIN_TIMEOUT` |
| `concurrency` is a positive integer | `INVALID_CONCURRENCY` |
| `maxPending`, when present, is a positive integer | `INVALID_MAX_PENDING` |
| `maxBodySize` is a non-negative integer | `INVALID_MAX_BODY_SIZE` |
| `retryAfter` is a non-negative integer | `INVALID_RETRY_AFTER` |
| `cors.origin` is present and of an allowed form | `INVALID_CORS` |
| `cors.origin` is `"*"` and `cors.credentials` is true | `INVALID_CORS` |
| Each `headers` value is `true`, `false`, a string, or (CSP only) a directive map | `INVALID_HEADERS` |
| A pattern is `/`-rooted, has no empty segments, has `*` only as the last segment | `INVALID_ROUTE` |
| A static prefix has no parameters or wildcard | `INVALID_ROUTE` |
| A route or middleware handler is a string or a function | `INVALID_HANDLER` |

Configuration rules are checked in the constructor and raised to the
caller. Wiring rules are checked at the call that adds the entry
(`INVALID_ROUTE`, `INVALID_HANDLER`, `DUPLICATE_ROUTE`, `LAUNCHED`) or
at launch (`UNKNOWN_*_WORKER`).

---

## Error System

| Type | Code | Category | Status |
|------|------|----------|--------|
| `INVALID_PORT` | 1000 | configuration | — |
| `INVALID_TIMEOUT` | 1001 | configuration | — |
| `INVALID_CONCURRENCY` | 1002 | configuration | — |
| `INVALID_MAX_PENDING` | 1003 | configuration | — |
| `INVALID_MAX_BODY_SIZE` | 1004 | configuration | — |
| `INVALID_DRAIN_TIMEOUT` | 1005 | configuration | — |
| `INVALID_RETRY_AFTER` | 1006 | configuration | — |
| `INVALID_CORS` | 1007 | configuration | — |
| `INVALID_HEADERS` | 1008 | configuration | — |
| `UNKNOWN_ROUTE_WORKER` | 2000 | wiring | — |
| `UNKNOWN_MIDDLEWARE_WORKER` | 2001 | wiring | — |
| `INVALID_ROUTE` | 2002 | wiring | — |
| `INVALID_HANDLER` | 2003 | wiring | — |
| `DUPLICATE_ROUTE` | 2004 | wiring | — |
| `LAUNCHED` | 2005 | wiring | — |
| `SEND_AFTER_DONE` | 3000 | lifecycle | — |
| `DONE_AFTER_DONE` | 3001 | lifecycle | — |
| `ENV_AFTER_DONE` | 3002 | lifecycle | — |
| `ALREADY_RESPONDED` | 3003 | lifecycle | — |
| `UNKNOWN_DELEGATE` | 3004 | lifecycle | 500 |
| `NOT_FOUND` | 4000 | http | 404 |
| `PAYLOAD_TOO_LARGE` | 4001 | http | 413 |
| `MALFORMED_BODY` | 4002 | http | 400 |
| `SERVICE_UNAVAILABLE` | 4003 | http | 503 |
| `GATEWAY_TIMEOUT` | 4004 | http | 504 |
| `INTERNAL` | 4005 | http | 500 |
| `HTTP` | 4006 | http | as given |
| `STREAM_FAILED` | 5000 | internal | — |
| `TASK_NOT_COMPLETED` | 5001 | internal | — |

The lifecycle conditions mirror the queue's by name on purpose: they
are the same misuse, raised by the server's wrapper instead of the
queue's guard so that they never halt the queue.

### Error Routing

1. **To the caller** — configuration and wiring errors raised by
   direct calls (`init`, `worker`, `use`, the verbs, `static`,
   `chain`, `launch`).
2. **To the client** — errors thrown inside a handler before the
   response has ended, and built-in rejections at the Listener or in
   built-in stages. Delivered as the request's response.
3. **To `onError`** — errors thrown inside a handler after the
   response ended, errors thrown inside a worker, the original cause
   behind any 500, stream failures, `TASK_NOT_COMPLETED`, and escaped
   failures reaching the halt handler.
4. **To the halt handler** — only a proxied `halt`, the server's own
   `close`, and escaped failures (server bugs).

---

## Scope Boundaries

### In Scope

- One queue per server, constructed active and concurrent
- Workers with the queue's own signature; handlers with the same plus
  `request` and `response`
- Routes and middleware bound to inline handlers or worker IDs,
  registered at launch
- Pipeline of stages with a built-in body parser first; `done()`
  forwards
- Per-request failure isolation, deadline with slot-leak duty, and
  admission
- Request and response classes
- Recovery from escaped failures, on by default
- CORS with preflight at the listener
- Security headers with Helmet's defaults and tri-state config
- Minimal static file serving
- Graceful close with drain
- Chaining instances before launch

### Out of Scope

- **TLS** — terminate in front of the server
- **WebSockets and upgrades** — the request/response model only
- **Multipart bodies and streaming request parsing** — `body` is
  left undefined and `raw` is available
- **Range requests, compression, ETags, directory listings**
- **Per-route timeouts or concurrency** — a later extension
- **Signal handling** — the application decides what a signal means
  and calls `close`
- **Session, cookie, and authentication helpers** — ordinary
  middleware
- **Clustering** — one process, one queue

---

## Conformance Test Cases

Tests launch on port 0 and use the host's HTTP client against the
bound port. Every test closes its server. Unless stated, handlers
respond and then call `done()`.

### Configuration

- Default config — port 3000, timeout 30000, concurrency 32,
  `maxPending` undefined, `maxBodySize` 1048576, `drainTimeout`
  10000, `retryAfter` 1, `recover` true, no CORS, headers undefined
- Each invalid config value in the Validation Rules table — the
  corresponding error is raised to the caller at construction
- `cors: { origin: "*", credentials: true }` — `INVALID_CORS`
- `headers: { "X-Frame-Options": 42 }` — `INVALID_HEADERS`
- `concurrency: 4` — the underlying queue reports `concurrent` true
  and `concurrency` 4, and is active before launch

### Wiring

- `worker("a", fn)` — chainable; a second `worker("a", fn)` raises
  the queue's `WORKER_ALREADY_BOUND`
- `GET("/x", fn)` with an inline function — after launch, the
  function serves `/x`; the queue's registry contains
  `hive:route:GET:/x`
- `GET("/x", "a")` before `worker("a", fn)` — accepted; launch
  succeeds once `a` is registered
- `GET("/x", "ghost")` then `launch()` — `UNKNOWN_ROUTE_WORKER`
  raised from launch; nothing is listening
- `use("ghost")` then `launch()` — `UNKNOWN_MIDDLEWARE_WORKER`
- `GET("/x", 42)` — `INVALID_HANDLER`
- `GET("/x", fn)` twice — `DUPLICATE_ROUTE`
- `GET("no-slash", fn)`, `GET("/a//b", fn)`, `GET("/a/*/b", fn)` —
  `INVALID_ROUTE`
- `static("/files/:x", dir)` — `INVALID_ROUTE`
- After `launch()`, each of `worker`, `use`, `GET`, `static`, `chain`
  — `LAUNCHED`
- `chain(other)` where both instances have only inline handlers —
  every route from both responds on this server; no ID collision
- `chain(other)` — a worker ID present in both raises
  `WORKER_ALREADY_BOUND`; a route present in both raises
  `DUPLICATE_ROUTE`

### Routing

- `GET("/users/:id", fn)`, request `/users/42` — handler runs with
  `request.route` `/users/:id` and `request.params.id` `"42"`
- `GET("/files/*", fn)`, request `/files/a/b.txt` — `params["*"]`
  is `a/b.txt`; request `/files` matches with `params["*"]` `""`
- Two routes that both match — the first registered wins
- Request with no matching route — 404 with the server error body
  and `NOT_FOUND` code; no handler runs; the admitted count is
  unchanged
- `HEAD` request to a `GET`-only route — same status and headers as
  `GET`, empty body
- Query `?a=1&a=2&b=3` — `query.a` is `["1","2"]`, `query.b` is `"3"`
- Percent-encoded path — `path` and `params` are decoded
- One worker ID bound to two routes — it runs for both and
  `request.route` distinguishes them

### Pipeline

- `use(m1)`, `use(m2)`, `GET("/x", r)` — invocation order is parser,
  `m1`, `m2`, `r`; each stage's `task.data` is the same request
  object
- Middleware responds, then calls `done()` — the task completes
  without forwarding; the route handler never runs
- Middleware calls `done()` without responding — the next stage runs
- Middleware responds and never calls `done()` — the route handler
  never runs; the slot is freed by the deadline's second duty and
  `onError` receives `TASK_NOT_COMPLETED`
- Middleware sets `request.locals.user` — the route handler reads it
- `use("/api", m)`, request `/other` — `m` does not run (wrapper
  forwards); request `/api/thing` — `m` runs
- Two requests in flight, concurrency 1 — the second request's first
  stage does not run until the first request's current stage
  completes
- Concurrency 2, three slow requests — exactly two stages execute at
  once

### Responding

- `response.status(201).header("X-A", "1").json({ok: true})` then
  `done()` — status 201, header present, JSON body, `Content-Type`
  `application/json`
- `response.send("text")` — `Content-Type` `text/plain` unless set
- `response.redirect("/there")` — 302 with `Location`; explicit
  status honored
- `response.end()` — empty body
- Handler responds and calls `done()` — the slot is freed (a
  following request runs before any deadline)
- Handler responds and never calls `done()`, `timeout: 50`,
  concurrency 1 — the client received its response immediately;
  the next request runs only after roughly 50ms; `onError` receives
  `TASK_NOT_COMPLETED`
- Handler calls a response helper twice — `ALREADY_RESPONDED` raised
  into the handler; `onError` receives it; client saw only the first
  response
- Handler calls `done()` twice — `DONE_AFTER_DONE` raised into the
  handler; `onError` receives it; the queue is still active
- Handler responds, calls `done()`, then keeps running and reads a
  local variable — no error

### Delegation

- Route handler calls `send("w", { response, n: 1 })` then `done()`;
  worker `w` reads `task.data.n`, ends the response through
  `task.data.response`, and calls `done()` — client receives `w`'s
  response; the handler's slot was freed at its `done()`
- Route handler delegates with data that does not include the
  response and calls `done()`; `w` completes — the client receives
  504 at the deadline (nobody responded)
- Route handler responds, then delegates — allowed; the worker's
  later response helper raises `ALREADY_RESPONDED` into the worker
- Route handler calls `done()` then `send` — `SEND_AFTER_DONE`
  raised into the handler; `onError` receives it; the queue is still
  active
- Route handler delegates to an unregistered ID — `UNKNOWN_DELEGATE`
  raised into the handler; uncaught, the client receives 500 with
  the `UNKNOWN_DELEGATE` code; the queue is still active
- Worker `w` delegates to worker `v` — `v` runs with the data `w`
  sent; workers chain like plain hive-queue workers
- Fan-out to two workers with the same response; both respond — the
  first wins; the second raises `ALREADY_RESPONDED`

### Failure Isolation

- Handler throws a native error — client receives 500 with the
  `INTERNAL` code; `onError` receives the original; the task is
  completed; a subsequent request is served normally
- Handler throws `HTTP(418, "teapot")` — client receives 418 with
  message `"teapot"` and the `HTTP` code; `onError` is not invoked
- Handler throws after responding — client unaffected; `onError`
  receives the error; the task is completed
- Handler throws a `HiveQueueError` — client receives 500; `onError`
  receives the queue error
- Worker throws — `onError` receives it; the worker's slot is freed;
  the queue is still active; if the worker held the response, the
  client receives 504 at the deadline
- Handler calls `setEnv` with an updater returning a function — the
  queue's `INVALID_ENV` is raised into the handler; uncaught, client
  receives 500
- Handler calls `getEnv` after `done()` — `ENV_AFTER_DONE` raised into
  the handler
- Two concurrent requests, one throws — the other completes normally

### Deadline

- `timeout: 50`, handler never responds or completes — client
  receives 504 with the `GATEWAY_TIMEOUT` code after roughly 50ms;
  the slot is freed; `onError` receives `TASK_NOT_COMPLETED`; the
  handler's later response helper raises `ALREADY_RESPONDED`
- `timeout: 50`, concurrency 1, two requests where the first holds
  its slot for 200ms — the second receives 504 without its handler
  ever running (deadline fired while pending; wrapper skipped it)
- Handler responds and completes at 20ms with `timeout: 50` — no 504;
  no `onError` call afterward
- Request that delegates across three workers totaling 80ms with
  `timeout: 50` — 504; deadline spans stages

### Admission

- `maxPending: 2`, three concurrent slow requests — the third
  receives 503 with `Retry-After` `1`; its handler never runs; the
  count returns to zero after the first two respond
- `maxPending: 1`, a request whose handler fans out to three
  workers — all three run; internal delegation is not counted
- Preflights during a full admission count — still answered 204
- `maxPending` unset — no 503 under load

### Request Class

- `from(raw, match)` — fields populated as specified; `body`
  undefined; `locals` empty
- `header("content-type")` and `header("Content-Type")` — same value
- `is("application/json")` — true for `application/json;
  charset=utf-8`, false otherwise
- `readBody(limit)` with JSON — `body` is the parsed value
- `readBody(limit)` with `a=1&a=2&b=3` URL-encoded — `body.a` is
  `["1","2"]`, `body.b` is `"3"`
- `readBody(limit)` with no body — `body` undefined
- `readBody(limit)` with `{}` — `body` is `{}`
- `readBody(limit)` with malformed JSON — raises `MALFORMED_BODY`
- `readBody(limit)` with a body over the limit — raises
  `PAYLOAD_TOO_LARGE` before the full body was consumed
- `readBody(limit)` with `application/octet-stream` — `body`
  undefined; `raw` has not been read

### Response Class

- `status(201)` then `end()` — host response has status 201; `onEnd`
  invoked once
- `header("X-A", "1")` then `json({})` — header present;
  `Content-Type` `application/json`; `Content-Length` set
- `send("text")` — `text/plain; charset=utf-8`
- `send(buffer)` — `application/octet-stream`
- `send(stream)` — piped; `onEnd` invoked when ending begins
- `redirect("/x")` — 302 and `Location`; `redirect("/x", 301)` — 301
- Any ending helper twice — `ALREADY_RESPONDED`; `onEnd` invoked once
- `status` or `header` after ending — `ALREADY_RESPONDED`
- `responded` false before, true after

### Body Parser Stage

- JSON request — route handler sees `request.body` parsed
- Malformed JSON — 400 with `MALFORMED_BODY`; route handler never
  runs
- Body over `maxBodySize` — 413 with `PAYLOAD_TOO_LARGE`; response
  arrives before the client finishes writing
- `application/octet-stream` — `body` undefined; the route handler
  can read `request.raw`

### CORS

- No `cors` config — no `Access-Control-*` headers on any response;
  preflight `OPTIONS` reaches the pipeline as an ordinary request
  (404 if unrouted)
- `origin: "https://a.test"`, preflight from that origin — 204 with
  `Allow-Origin` echoing it, `Allow-Methods`, reflected
  `Allow-Headers`, `Vary: Origin`; no task; admitted count unchanged
- Preflight from another origin — 204 with no CORS headers
- `origin: "*"` — `Allow-Origin` is `*` and no `Vary`
- `origin: ["https://a.test", "https://b.test"]` — both match, a
  third does not
- `origin: (o) => o.endsWith(".test")` — predicate consulted
- `credentials: true` — `Allow-Credentials: true` on preflight and
  on admitted responses
- `exposedHeaders: ["X-A"]` — `Expose-Headers` on admitted responses
- `maxAge: 600` — `Max-Age` on preflight
- Admitted `GET` from a matching origin — `Allow-Origin` present;
  from a non-matching origin — absent, response otherwise normal
- Handler sets `Access-Control-Allow-Origin` itself — handler's value
  wins
- `OPTIONS` without `Access-Control-Request-Method` — routed as an
  ordinary request

### Security Headers

- Default config — every header in the defaults table is present
  with its default value on a routed response, a 404, and a preflight
- `headers: false` — none present
- `headers: { "X-Frame-Options": false }` — that header absent, the
  rest present
- `headers: { "X-Frame-Options": "DENY" }` — that value used
- `headers: { "Content-Security-Policy": { "default-src": ["'self'"], "img-src": ["'self'", "data:"] } }`
  — serialized as `default-src 'self';img-src 'self' data:`
- `headers: { "Cross-Origin-Embedder-Policy": "require-corp" }` —
  present; absent by default
- Handler overrides `X-Frame-Options` via `response.header` — the
  handler's value is sent

### Static

- `static("/pub", dir)`, `GET /pub/a.txt` — 200 with the file,
  `Content-Type` `text/plain`, `Content-Length`, `Last-Modified`
- `GET /pub/sub/` with `index.html` present — 200 with it; without —
  404
- `GET /pub/../secret` and encoded variants — 404
- `GET /pub/missing` — 404
- `HEAD /pub/a.txt` — headers as `GET`, empty body
- `If-Modified-Since` equal to the file's mtime — 304
- Unknown extension — `application/octet-stream`; adding to the
  exported table changes it
- `use(m)` registered — `m` runs for static requests; `use("/api",
  m)` — it does not
- Static task completes once streaming begins — with concurrency 1,
  a second request is served while a large file is still streaming

### Halt and Recovery

- Handler calls `halt("bye")` — client receives 503; the server
  stops accepting; `onHalt` receives `"bye"`; `close` resolves; the
  port is released
- Worker calls `halt("bye")` — same, except no client response is
  sent by the server (the worker's data is opaque)
- Handler calls `halt` while another request is in flight — the
  other request completes and its response is delivered before
  `onHalt` fires (drain)
- `recover: true` (default), the halt path is reached other than via
  `close` or a proxied `halt` (drive this by calling the queue's own
  `halt` directly, since no handler path can reach it) — `onError`
  receives a recovery event; `onHalt` is not called; a subsequent
  request is served; requests pending in the task list at the moment
  of halt are served
- Same with `recover: false` — `onError` receives the value;
  `onHalt` receives it; the server stops
- Request in a handler when recovery happens — its response is still
  delivered; if the handler never responds, its deadline still fires

### Lifecycle

- `launch()` resolves with the server listening; the bound port is
  exposed; `cb` receives the server
- `launch()` twice — `LAUNCHED`
- `close()` before `launch()` — no-op, resolves
- `close()` with no requests — resolves promptly; `onHalt` invoked
  once with the shutdown value
- `close()` with a request in flight — new requests on a fresh
  connection are refused; a request on an existing keep-alive
  connection receives 503 with `Connection: close`; the in-flight
  request completes normally; then `onHalt`
- `close()` with `drainTimeout: 50` and a handler that never responds
  — after roughly 50ms the request receives 503 and its task is
  completed; `close` resolves
- `close()` twice — the second resolves without a second `onHalt`
- `onHalt` set twice — the last one wins

### Error Class

- Each factory produces its table code, category, and status
- `HTTP(418, "m")` — code `HTTP`, status 418, message `"m"`
- `INTERNAL(cause)` — cause chained
- `is` — true for server errors, false for queue errors and natives
- `log()` — `[http:4000:404] ...`; `[wiring:2005] ...` for a
  condition without a status

---

## Implementation Checklist

1. Error class — codes, categories, statuses, factories, `is`, `log`
2. Response class — pending state, ending helpers, `onEnd`,
   `ALREADY_RESPONDED`
3. Request class — factory, accessors, `readBody`
4. Config validation and defaults; queue construction
5. Pattern parsing and route matching, including wildcard, HEAD
   fallback, and prefix matching for middleware
6. Wrappers: worker wrapper; handler wrapper with forwarding,
   skip-if-responded, path-scope pass-through, error responses
7. Listener: security headers, preflight, closing check, admission
   check, route match, request and response construction, CORS
   response headers, deadline, first send
8. Body parser stage
9. Static handler and extension table
10. Halt handler: closing branch, recovery branch
11. `launch` (built-in and inline registration, wiring validation,
    pipeline) and `close` (drain)
12. `chain`

Each step depends only on earlier steps.

---

## Appendix: Annotations

1. **Native HTTP, no dependencies.** CORS, security headers, body
   parsing, routing, and static serving are implemented rather than
   wrapped. This keeps one request pipeline under the queue and
   matches the conventions Hive Queue follows.
2. **Every stage is a worker.** `use` and the verbs register workers;
   the pipeline is a chain of `send`s performed by the wrapper on
   `done()`. The cost is a scheduler turn per stage and a concurrency
   limit that counts stages rather than requests; the benefit is one
   primitive.
3. **Inline handlers register at launch.** Binding a function creates
   an entry, not a worker, so `chain` needs no ID coordination and the
   fluent chain is order-independent. IDs are generated from the
   entry's position or route, namespaced under `hive:`.
4. **Two contexts, one contract.** A handler is a worker with
   `request` and `response` added. Nothing is removed and no verb is
   added. `done()` is the only completion in both, and in a middleware
   stage it also forwards, because the stage does not know its
   successor and the server does.
5. **Responding does not complete.** An earlier draft had the ending
   helpers complete the task. That created a second completion path,
   made a worker's completion depend on what was in its task data,
   and contradicted the queue's continuation contract, under which a
   function returning means nothing and only `done()` means done.
   Keeping them separate costs one line per handler and removes a
   rule.
6. **The deadline's second duty.** With responding and completing
   separate, a handler can respond and forget `done()`, leaking a
   slot the request deadline would otherwise not touch. The deadline
   therefore also completes an uncompleted handler task and reports
   `TASK_NOT_COMPLETED`. This is server policy layered on the queue's
   starvation rule, not a change to it.
7. **Delegation data is explicit.** A handler that wants a worker to
   respond puts the response object in the data it sends. The server
   never smuggles context into a worker's task. The cost is that the
   server cannot respond on a throwing worker's behalf; the deadline
   covers that case.
8. **The wrapper absorbs the queue's guards.** Server functions never
   trigger the queue's lifecycle guards; the same misuse is raised by
   the wrapper under the same condition names, then caught. This is
   what keeps a worker typo from halting the server.
9. **Deadline armed at admission.** Queue wait time counts.
10. **Admission counts requests, not tasks.** The task list contains
    internal hops; `maxPending` must not.
11. **Halt stops the server.** A `halt` is a shutdown request, not a
    request-level error.
12. **Recovery on by default.** An escaped failure is a server bug;
    the default keeps serving and logs loudly.
13. **Body parsing is a stage** so a slow upload holds a slot and is
    bounded by concurrency and the deadline. `readBody` lives on the
    request class so a handler can call it with its own limit for
    content types the stage ignores.
14. **Preflight at the listener.** Header-only, no task, no admission.
15. **Helmet's defaults verbatim,** with the CSP directive map because
    writing CSP as a string is error-prone.
16. **Static is minimal and in scope** for the traversal protection.
17. **404 at the listener.** Unrouted requests never enter the
    pipeline. A project that wants middleware to see them binds a
    wildcard route last.
18. **Signals are the application's.**
19. **Default concurrency of 32** is a judgment call for an I/O-bound
    single-process server.
