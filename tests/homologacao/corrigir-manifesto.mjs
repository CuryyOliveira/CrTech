// Homologação local: o preset node-server do Nitro grava o tamanho dos arquivos estáticos antes
// do plugin PWA reescrever sw.js; corrige tamanho/etag conforme o arquivo real.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const idx = path.join(dir, "server/index.mjs");
let s = readFileSync(idx, "utf8");
let n = 0;
s = s.replace(
  /"etag": "[^\n]*",\n(\s*)"mtime": "([^"]*)",\n\s*"size": (\d+),\n\s*"path": "([^"]+)"/g,
  (m, ind, mtime, size, p) => {
    const real = statSync(path.join(dir, "server", p)).size;
    if (real === Number(size)) return m;
    n++;
    return `"etag": "\\"${real.toString(16)}-corrigido\\"",\n${ind}"mtime": "${mtime}",\n${ind}"size": ${real},\n${ind}"path": "${p}"`;
  },
);
writeFileSync(idx, s);
console.log(`manifesto: ${n} arquivo(s) corrigido(s)`);
