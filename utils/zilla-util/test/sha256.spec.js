import { describe, it } from "mocha";
import { expect } from "chai";
import shasum from "shasum";
import { sha256 } from "../lib/esm/index.js";

describe("test sha256", () => {
    const data = "fooBar-" + Date.now();
    it("correctly calculates a SHA-256", () => {
        const realSha = shasum(data, "SHA256");
        const mySha = sha256(data);
        expect(mySha).eq(realSha);
    });
});
