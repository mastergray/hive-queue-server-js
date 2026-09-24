// Public surface of hive-queue-server: every public class as a named export, every public type with export type.

// Classes:
import HiveQueueServer from "./HiveQueueServer/HiveQueueServer.js";                             // The server
import HiveQueueServerError from "./HiveQueueServerError/HiveQueueServerError.js";              // Base typed error
import HiveQueueServerHTTPError from "./HiveQueueServerHTTPError/HiveQueueServerHTTPError.js";  // Error carrying an HTTP status
import HiveQueueServerRequest from "./HiveQueueServerRequest/HiveQueueServerRequest.js";        // Parsed request handed to handlers
import HiveQueueServerResponse from "./HiveQueueServerResponse/HiveQueueServerResponse.js";     // Response object handlers write through
import HiveQueueServerRoute from "./HiveQueueServerRoute/HiveQueueServerRoute.js";              // Route pattern parsing and matching

export {
    HiveQueueServer,
    HiveQueueServerError,
    HiveQueueServerHTTPError,
    HiveQueueServerRequest,
    HiveQueueServerResponse,
    HiveQueueServerRoute
};

// Shared types:
export { isNonEmptyString, type NonEmptyString } from "./shared.types.js";

// Error types:
export {
    isHiveQueueServerErrorConfig,
    type HiveQueueServerErrorConfig,
    type HiveQueueServerErrorLogEntry,
    type HiveQueueServerErrorLogFormatter
} from "./HiveQueueServerError/types.js";

// HTTP error types:
export {
    isHiveQueueServerHTTPErrorConfig,
    type HiveQueueServerHTTPErrorConfig,
    type HiveQueueServerHTTPErrorLogEntry,
    type HiveQueueServerHTTPErrorLogFormatter,
    type HiveQueueServerHTTPErrorResponse
} from "./HiveQueueServerHTTPError/types.js";

// Response types:
export {
    isHiveQueueServerResponseOnEnd,
    type HiveQueueServerResponseBody,
    type HiveQueueServerResponseOnEnd
} from "./HiveQueueServerResponse/types.js";

// Request types:
export type {
    HiveQueueServerHeaders,
    HiveQueueServerParsedUrl,
    HiveQueueServerQuery,
    HiveQueueServerRequestFields
} from "./HiveQueueServerRequest/types.js";

// Route types:
export {
    isHiveQueueServerRoutePattern,
    type HiveQueueServerRoutable,
    type HiveQueueServerRouteMatch,
    type HiveQueueServerRouteSegment,
    type HiveQueueServerRouteSelection
} from "./HiveQueueServerRoute/types.js";

// Server types:
export {
    isHiveQueueServerCallback,
    isHiveQueueServerCorsConfig,
    isHiveQueueServerCspDirectives,
    isHiveQueueServerHeaderSetting,
    isHiveQueueServerPort,
    isNonNegativeInteger,
    isPositiveInteger,
    isStringList,
    type HiveQueueServerConfig,
    type HiveQueueServerCorsConfig,
    type HiveQueueServerCspDirectives,
    type HiveQueueServerHeaderSetting,
    type HiveQueueServerHeadersConfig,
    type HiveQueueServerOnError,
    type HiveQueueServerOnHalt,
    type HiveQueueServerOriginPredicate
} from "./HiveQueueServer/types.js";
