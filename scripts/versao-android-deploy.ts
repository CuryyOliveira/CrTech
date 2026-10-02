/**
 * Versão Android oficial para as reservas do Worker (só versionName/versionCode): a variável
 * VERSAO_ANDROID_DEPLOY (deploy Web) e o segredo VERSAO_ANDROID_RELEASE (após publicar um APK).
 *
 * Lê no GitHub (no CI, com o GITHUB_TOKEN do próprio workflow) a maior release Android oficial, com
 * as mesmas regras do endpoint (sem draft/prerelease, tag android-vX.Y.Z, versionCode das notas).
 * O token nunca é impresso nem enviado ao Worker.
 *
 * Modos:
 *  - padrão (deploy Web): falha → sai 0 (o deploy segue) e imprime a versão já publicada (--atual),
 *    validada, para a reserva não ficar vazia; sem ela, imprime vazio;
 *  - --estrito (após publicar um APK): qualquer problema → mensagem clara e saída 1 (workflow
 *    vermelho, nada é gravado). Com --tag, exige que essa release exista, seja oficial e seja a
 *    maior publicada.
 * Nos dois modos, com --atual (JSON lido do endpoint de produção), nunca devolve versão inferior.
 */
import {
  codigoValido,
  compararVersoes,
  escolherRelease,
  lerVersaoRemota,
  REPOSITORIO_OFICIAL,
  versaoDaTag,
  type VersaoApp,
} from "../src/lib/atualizacao-app/versao";

export type Payload = { versionName: string; versionCode: number };

/** Decide o que gravar no Worker; lança Error com o motivo quando não há o que gravar com segurança. */
export function decidirVersaoWorker(
  releases: unknown,
  opcoes: { tag?: string; atual?: unknown } = {},
): Payload {
  const maior = escolherRelease(releases);
  if (!maior) throw new Error("nenhuma release Android oficial válida no GitHub");
  if (!codigoValido(maior.versionCode)) {
    throw new Error(`release android-v${maior.versionName} sem "versionCode N" válido nas notas`);
  }
  if (opcoes.tag !== undefined) {
    const esperada = versaoDaTag(opcoes.tag);
    if (!esperada) throw new Error(`tag fora do padrão oficial android-vX.Y.Z: ${opcoes.tag}`);
    const oficial = escolherRelease(
      Array.isArray(releases)
        ? releases.filter((r) => (r as { tag_name?: unknown })?.tag_name === opcoes.tag)
        : [],
    );
    if (!oficial) {
      throw new Error(`release ${opcoes.tag} não encontrada como oficial (draft/pré-release?)`);
    }
    if (compararVersoes(esperada, maior.versionName) !== 0) {
      throw new Error(
        `release ${opcoes.tag} não é a maior oficial (maior: android-v${maior.versionName})`,
      );
    }
  }
  const atual: VersaoApp | null = lerVersaoRemota(opcoes.atual);
  if (atual && compararVersoes(maior.versionName, atual.versionName) < 0) {
    throw new Error(
      `versão ${maior.versionName} é inferior à já publicada ${atual.versionName}: não sobrescreve`,
    );
  }
  // Só estes dois campos seguem para o Worker.
  return { versionName: maior.versionName, versionCode: maior.versionCode };
}

function argumento(argv: string[], nome: string): string | undefined {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Executa o script; devolve o código de saída. Dependências injetáveis para os testes. */
export async function executar(dep: {
  argv: string[];
  token?: string;
  fetch: typeof fetch;
  saida: (s: string) => void;
  erro: (s: string) => void;
}): Promise<number> {
  const estrito = dep.argv.includes("--estrito");
  const tag = argumento(dep.argv, "--tag");
  const atualBruto = argumento(dep.argv, "--atual");
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "conferencia-rapida-deploy",
    "x-github-api-version": "2022-11-28",
  };
  if (dep.token) headers.authorization = `Bearer ${dep.token}`;
  let atual: unknown;
  try {
    atual = atualBruto ? JSON.parse(atualBruto) : undefined;
  } catch {
    atual = undefined; // endpoint indisponível ou resposta inválida: sem comparação
  }
  try {
    const resp = await dep.fetch(
      `https://api.github.com/repos/${REPOSITORIO_OFICIAL}/releases?per_page=30`,
      { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) },
    );
    if (!resp.ok) throw new Error(`GitHub respondeu HTTP ${resp.status}`);
    const payload = decidirVersaoWorker(await resp.json(), { tag, atual });
    dep.saida(JSON.stringify(payload));
    return 0;
  } catch (e) {
    dep.erro(`versao-android-deploy: ${e instanceof Error ? e.message : String(e)}`);
    if (estrito) return 1;
    // Deploy Web: em vez de gravar vazio (perdendo a reserva), mantém a versão já publicada,
    // validada com as mesmas regras.
    const publicada = lerVersaoRemota(atual);
    if (publicada && codigoValido(publicada.versionCode)) {
      dep.saida(
        JSON.stringify({ versionName: publicada.versionName, versionCode: publicada.versionCode }),
      );
    }
    return 0;
  }
}

// Executado como script (vite-node scripts/versao-android-deploy.ts ...); nos testes (Vitest) é
// apenas importado.
if (!process.env.VITEST) {
  process.exitCode = await executar({
    argv: process.argv.slice(2),
    token: process.env.GITHUB_TOKEN,
    fetch,
    saida: (t) => process.stdout.write(t),
    erro: (t) => console.error(t),
  });
}
