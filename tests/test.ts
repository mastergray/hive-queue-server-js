import CTGTest from "ctg-js-test";
import CTGTestConsoleFormatter from "ctg-js-test/formatter/console";
import CTGTestResult from "ctg-js-test/result";

// Conformance categories are chained here in the order of the design doc's
// conformance section as each is implemented.
const state = await CTGTest.init("hive-queue-server conformance")
    .start(undefined, {
        haltOnFailure: false,
        timeout: 5000
    });

console.log(CTGTestConsoleFormatter.format(state));

if (state.status === CTGTestResult.STATUS.FAIL || state.status === CTGTestResult.STATUS.ERROR) {
    throw new Error("HiveQueueServer conformance suite failed.");
}
