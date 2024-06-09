import { createConsola, LogType, LogLevels, ConsolaInstance } from "consola/core";

export const logLevel = (level: LogType): number => (level && LogLevels[level] ? LogLevels[level] : LogLevels["warn"]);

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

export const logger: MobilettoLogger = createConsola({
    level: logLevel(process?.env?.MOBILETTO_LOG_LEVEL as LogType),
    reporters: [
        {
            log: (logObj) => {
                console.log(JSON.stringify(logObj));
            },
        },
    ],
}) as MobilettoLogger;

logger.isSilent = () => logger.level === LogLevels["silent"];
logger.isAnyEnabled = () => logger.level > LogLevels["silent"];
logger.isErrorEnabled = () => logger.level >= LogLevels["error"];
logger.isWarningEnabled = () => logger.level >= LogLevels["warn"];
logger.isNormalEnabled = () => logger.level >= LogLevels["log"];
logger.isInfoEnabled = () => logger.level >= LogLevels["info"];
logger.isDebugEnabled = () => logger.level >= LogLevels["debug"];
logger.isTraceEnabled = () => logger.level >= LogLevels["trace"];
logger.isVerboseEnabled = () => logger.level >= LogLevels["verbose"];

logger.setLogLevel = (level: LogType | string | number) => {
    logger.level = typeof level === "number" ? level : logLevel(level as LogType);
};
