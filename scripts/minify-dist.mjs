import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { transform } from "esbuild";

async function findJavaScriptFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            return findJavaScriptFiles(path);
        }

        return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }));

    return files.flat();
}

const files = await findJavaScriptFiles("dist");

await Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    const result = await transform(source, {
        format: "esm",
        legalComments: "none",
        minify: true,
        platform: "node",
        target: "es2022"
    });

    await writeFile(file, result.code);
}));
