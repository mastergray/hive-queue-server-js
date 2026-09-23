import { HiveQueueServerError } from "../../src/index.ts";

export const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

export const throwsHiveQueueServerError = (fn: () => unknown, code: number): boolean => {
    try {
        fn();
        return false;
    } catch (err) {
        return HiveQueueServerError.is(err) && err.code === code;
    }
};

export const rejectsHiveQueueServerError = async (fn: () => Promise<unknown>, code: number): Promise<boolean> => {
    try {
        await fn();
        return false;
    } catch (err) {
        return HiveQueueServerError.is(err) && err.code === code;
    }
};

export const isHiveQueueServerError = (value: unknown, code: number): boolean => {
    return HiveQueueServerError.is(value) && value.code === code;
};
