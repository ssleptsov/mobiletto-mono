import {
    S3Client,
    // This command supersedes the ListObjectsCommand and is the recommended way to list objects.
    ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import "dotenv/config";
import {
    M_DIR,
    M_FILE,
    MobilettoNotFoundError,
    logger,
    connect,
    mobiletto,
    registerDriver,
    flushAll,
    shutdownMobiletto,
    rand,
    MobilettoOptions,
} from "mobiletto-base";
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
    key: process.env.MOBILETTO_TEST_S3_KEY!,
    secret: process.env.MOBILETTO_TEST_S3_SECRET!,
    opts: {
        bucket: process.env.MOBILETTO_TEST_S3_BUCKET!,
        prefix: process.env.MOBILETTO_TEST_S3_PREFIX!,
        region: process.env.MOBILETTO_TEST_S3_REGION!,
    },
    redisConfig: {
        enabled: false,
    },
};

import { storageClient as s3Driver } from "./index.js";
registerDriver("s3", s3Driver as any);

export const main = async () => {
    const api = await mobiletto(driverName, config.key, config.secret, {
        key: config.key,
        secret: config.secret,
        ...config.opts,
    } as any);
    const output = await api.list('', { paging: { maxItems: 3 } });

    console.log("output", output);
};

main();
