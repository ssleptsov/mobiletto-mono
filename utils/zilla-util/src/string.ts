export const capitalize = (s: string): string =>
    s && s.length > 0 ? s.substring(0, 1).toUpperCase() + s.substring(1) : "";

export const uncapitalize = (s: string): string =>
    s && s.length > 0 ? s.substring(0, 1).toLowerCase() + s.substring(1) : "";

export const basefilename = (s: string): string => {
    if (!s) return s; // return null/undefined as-is

    // drop trailing slashes
    while (s.endsWith("/")) {
        s = s.substring(0, s.length - 1);
    }
    const i = s ? s.lastIndexOf("/") : -1;
    return i === -1 ? s : s.substring(i + 1);
};

export const basefilenameWithoutExt = (s: string): string => {
    s = basefilename(s);
    if (!s) return s; // return null/undefined as-is

    // drop trailing dots
    while (s.endsWith(".")) {
        s = s.substring(0, s.length - 1);
    }
    const i = s ? s.lastIndexOf(".") : -1;
    return i === -1 ? s : s.substring(0, i);
};

export const dateAsYYYYMMDD = (date: Date): string =>
    `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date
        .getDate()
        .toString()
        .padStart(2, "0")}`;

export const dateAsYYYYMMDDHHmmSS = (date: Date): string =>
    `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}${date
        .getDate()
        .toString()
        .padStart(2, "0")}-${("" + date.getHours()).padStart(2, "0")}${("" + date.getMinutes()).padStart(2, "0")}${(
        "" + date.getSeconds()
    ).padStart(2, "0")}`;

export const timestampAsYYYYMMDD = (timestamp: number): string => dateAsYYYYMMDD(new Date(timestamp));

export const timestampAsYYYYMMDDHHmmSS = (timestamp: number): string => dateAsYYYYMMDDHHmmSS(new Date(timestamp));
