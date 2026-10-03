// Bündelt den API-Einstiegspunkt zu einer einzelnen Datei für Bunny Edge Scripting
// (gleicher Ansatz wie Bunnys offizielles Deno-Template: esbuild + Deno-Loader).
// Aufruf aus dem Repo-Root: deno run -A deploy/build-api.ts
import * as esbuild from "npm:esbuild";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader";
import { join } from "jsr:@std/path";

const root = Deno.cwd();

await esbuild.build({
  plugins: [...denoPlugins({ configPath: join(root, "deno.json") })],
  // Relativ zum Repo-Root: absolute Windows-Pfade verliert der Deno-Loader den Laufwerksbuchstaben.
  entryPoints: ["./server/bunny.ts"],
  outfile: join(root, "dist", "api", "index.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
});

await esbuild.stop();
