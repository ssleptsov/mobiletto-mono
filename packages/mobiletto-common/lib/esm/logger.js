var _a;
import { createConsola, LogLevels } from "consola/core";
export const logLevel = (level) => (level && LogLevels[level] ? LogLevels[level] : LogLevels["warn"]);
export const logger = createConsola({
    level: logLevel((_a = process === null || process === void 0 ? void 0 : process.env) === null || _a === void 0 ? void 0 : _a.MOBILETTO_LOG_LEVEL),
    reporters: [
        {
            log: (logObj) => {
                console.log(JSON.stringify(logObj));
            },
        },
    ],
});
logger.isSilent = () => logger.level === LogLevels["silent"];
logger.isAnyEnabled = () => logger.level > LogLevels["silent"];
logger.isErrorEnabled = () => logger.level >= LogLevels["error"];
logger.isWarningEnabled = () => logger.level >= LogLevels["warn"];
logger.isNormalEnabled = () => logger.level >= LogLevels["log"];
logger.isInfoEnabled = () => logger.level >= LogLevels["info"];
logger.isDebugEnabled = () => logger.level >= LogLevels["debug"];
logger.isTraceEnabled = () => logger.level >= LogLevels["trace"];
logger.isVerboseEnabled = () => logger.level >= LogLevels["verbose"];
logger.setLogLevel = (level) => {
    logger.level = typeof level === "number" ? level : logLevel(level);
};
//# sourceMappingURL=logger.js.map