/**
 * Lê no GitHub (no CI, com o GITHUB_TOKEN do próprio workflow) a release Android oficial mais
 * recente e imprime só {"versionName","versionCode"}, com as mesmas regras do endpoint. O deploy
 * grava esse JSON na variável VERSAO_ANDROID_DEPLOY do Worker (última versão conhecida, caso o
 * GitHub recuse a consulta feita pela Cloudflare). O token nunca é impresso nem enviado ao Worker.
 * Falha → imprime vazio (o deploy segue; o endpoint usa as outras camadas).
 */
import { escolherRelease, REPOSITORIO_OFICIAL } from "../src/lib/atualizacao-app/versao";

async function main() {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "conferencia-rapida-deploy",
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPOSITORIO_OFICIAL}/releases?per_page=30`,
      { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const v = escolherRelease(await resp.json());
    if (!v) throw new Error("nenhuma release oficial válida");
    process.stdout.write(
      JSON.stringify({ versionName: v.versionName, versionCode: v.versionCode }),
    );
  } catch (e) {
    console.error(`versao-android-deploy: ${String(e)}`);
  }
}

await main();
