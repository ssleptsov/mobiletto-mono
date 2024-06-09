var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "dotenv/config";
import { mobiletto, registerDriver, } from "mobiletto-base";
// const client = new S3Client({
//     credentials: {
//         accessKeyId: process.env.MOBILETTO_TEST_S3_KEY || "",
//         secretAccessKey: process.env.MOBILETTO_TEST_S3_SECRET || "",
//     },
//     region: 'eu-west-1'
// });
// export const main = async () => {
//     const command = new ListObjectsV2Command({
//         Bucket: process.env.MOBILETTO_TEST_S3_BUCKET,
//         // The default and maximum number of keys returned is 1000. This limits it to
//         // one for demonstration purposes.
//         MaxKeys: 1,
//     });
//     try {
//         let isTruncated = true;
//         console.log("Your bucket contains the following objects:\n");
//         let contents = "";
//         while (isTruncated) {
//             const { Contents, IsTruncated, NextContinuationToken, ContinuationToken } = await client.send(command);
//             const contentsList = Contents?.map((c) => ` • ${c.Key} - ${ContinuationToken} || ${NextContinuationToken}`).join("\n");
//             contents += contentsList + "\n";
//             isTruncated = IsTruncated ?? false;
//             command.input.ContinuationToken = NextContinuationToken;
//         }
//         console.log(contents);
//     } catch (err) {
//         console.error(err);
//     }
// };
const driverName = "s3";
const config = {
    key: process.env.MOBILETTO_TEST_S3_KEY,
    secret: process.env.MOBILETTO_TEST_S3_SECRET,
    opts: {
        bucket: process.env.MOBILETTO_TEST_S3_BUCKET,
        prefix: process.env.MOBILETTO_TEST_S3_PREFIX,
        region: process.env.MOBILETTO_TEST_S3_REGION,
    },
    redisConfig: {
        enabled: false,
    },
};
import { storageClient as s3Driver } from "./index.js";
registerDriver("s3", s3Driver);
export const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const api = yield mobiletto(driverName, config.key, config.secret, Object.assign({ key: config.key, secret: config.secret }, config.opts));
    const output = yield api.list('', { paging: { maxItems: 3 } });
    console.log("output", output);
});
main();
//# sourceMappingURL=test.js.map