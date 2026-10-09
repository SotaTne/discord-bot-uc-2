import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { bundleScript } from "../src/bundle";

// clasp が、dist の中身を Apps Script に置く（.clasp.json の rootDir）
await mkdir("dist", { recursive: true });
await writeFile("dist/Code.js", await bundleScript());
await copyFile("appsscript.json", "dist/appsscript.json");
console.log("dist/Code.js を作りました");
