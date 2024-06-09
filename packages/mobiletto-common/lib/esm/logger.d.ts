import { LogType, ConsolaInstance } from "consola/core";
export declare const logLevel: (level: LogType) => number;
export type MobilettoLogger = ConsolaInstance & {
    isSilent: () => boolean;
    isAnyEnabled: () => boolean;
    isErrorEnabled: () => boolean;
    isWarningEnabled: () => boolean;
    isNormalEnabled: () => boolean;
    isInfoEnabled: () => boolean;
    isDebugEnabled: () => boolean;
    isTraceEnabled: () => boolean;
    isVerboseEnabled: () => boolean;
    setLogLevel: (level: LogType | string | number) => void;
};
export declare const logger: MobilettoLogger;
