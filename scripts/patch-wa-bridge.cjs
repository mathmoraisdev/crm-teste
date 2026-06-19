/**
 * Patch de runtime do `whatsapp-rust-bridge` (dependência nativa do Baileys 7).
 *
 * O pacote é `"type": "module"` e seu `exports["."]` só define a condição
 * `import` (ESM) — sem `default`/`require`. Nosso worker roda em CommonJS (via
 * tsx, projeto sem `"type":"module"`), então o Baileys faz `require()` do bridge
 * e o Node não acha condição CJS → `ERR_PACKAGE_PATH_NOT_EXPORTED` (o worker
 * crasha no boot em produção). Adicionamos `default` apontando para o mesmo
 * arquivo ESM; o Node 22.12+/24 carrega via require(esm) (o bundle não usa
 * top-level await).
 *
 * Roda no `postinstall`. Idempotente. No-op se o pacote não existir (ex.: se um
 * dia voltarmos ao Baileys 6, que não tem essa dependência).
 */
const fs = require("node:fs");
const path = require("node:path");

// Caminho direto no filesystem: NÃO usar require.resolve(".../package.json"),
// pois o próprio exports do pacote bloqueia subpaths e a resolução falha.
const pkgPath = path.join(
  process.cwd(),
  "node_modules",
  "whatsapp-rust-bridge",
  "package.json",
);

try {
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const entry = pkg.exports && pkg.exports["."];
    if (entry && entry.import && !entry.default) {
      entry.default = entry.import;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log("[postinstall] whatsapp-rust-bridge: condição exports.default adicionada");
    }
  }
} catch (e) {
  console.warn("[postinstall] patch-wa-bridge falhou (ignorado):", e && e.message);
}
