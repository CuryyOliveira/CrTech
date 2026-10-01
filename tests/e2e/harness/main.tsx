/**
 * Harness E2E: a MESMA tela de conferência V2 do app (ConferenceScreen) sobre o motor V2 real
 * (IndexedDB do navegador), falando com o servidor de teste. Sem login/rotas: o usuário e a
 * lista vêm da URL (?usuario=&lista=).
 */
import "@/styles.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConferenceStatusBadge } from "@/components/conferencia-v2/ConferenceStatusBadge";
import { ConferenceSyncBadge } from "@/components/conferencia-v2/ConferenceSyncStatus";
import { RESUMO_VAZIO } from "@/lib/sync-v2";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { ConferenceScreen } from "@/components/conferencia-v2/ConferenceScreen";
import { AvisoNovaVersao } from "@/components/AvisoNovaVersao";
import { MotorSync } from "@/lib/sync-v2/motor";
import { encerrada } from "@/lib/sync-v2/projecao";
import { redeSimulada, TransporteHttp } from "./transporte-http";

const params = new URLSearchParams(location.search);
const USUARIO = params.get("usuario") ?? "";
const LISTA = params.get("lista") ?? "";
const EMPRESA = params.get("empresa");
const FAMILIA = params.get("familia") ?? "caminhao";
// ?aviso=1: monta o aviso de nova versão do APK (como na tela inicial do app).
const AVISO = params.get("aviso") === "1";
// Emulador Android: reabrir o app "sem internet" (o sessionStorage some quando o app é fechado).
if (params.get("offline") === "1") redeSimulada.offline = true;
if (params.get("offline") === "0") redeSimulada.offline = false;

declare global {
  interface Window {
    __cr?: { motor: MotorSync; rede: typeof redeSimulada };
  }
}

function App() {
  const [motor, setMotor] = useState<MotorSync | null>(null);
  const [conf, setConf] = useState<string | null>(null);
  const [saiu, setSaiu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let m: MotorSync | null = null;
    void (async () => {
      m = await MotorSync.abrir(
        { userId: USUARIO, empresaId: EMPRESA, deviceId: `e2e-${USUARIO.slice(0, 4)}` },
        new TransporteHttp(USUARIO),
        {
          automatico: true,
          online: () => !redeSimulada.offline,
          backoffBaseMs: 200,
          backoffMaxMs: 1000,
        },
      );
      window.__cr = { motor: m, rede: redeSimulada };
      setMotor(m);
      if (!redeSimulada.offline) await m.sincronizarAgora();
      const atualizar = async () => {
        const abertas = (await m!.conferencias()).filter(
          (c) => c.unidade_id === LISTA && !encerrada(c.status),
        );
        // Como na rota do app: a conferência mostrada fica até o usuário sair.
        setConf((atual) => atual ?? abertas[0]?.id ?? null);
      };
      await atualizar();
      setPronto(true);
      m.aoAlterarDados(() => void atualizar());
    })().catch((e) => setErro(String(e)));
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!motor || !pronto) return <p>Abrindo…</p>;
  return (
    <>
      {AVISO && <AvisoNovaVersao motor={motor} emOperacao={!!conf} />}
      <Tela
        motor={motor}
        conf={conf}
        setConf={setConf}
        saiu={saiu}
        setSaiu={setSaiu}
        setErro={setErro}
      />
    </>
  );
}

function Tela({
  motor,
  conf,
  setConf,
  saiu,
  setSaiu,
  setErro,
}: {
  motor: MotorSync;
  conf: string | null;
  setConf: (c: string | null) => void;
  saiu: boolean;
  setSaiu: (v: boolean) => void;
  setErro: (e: string) => void;
}) {
  if (saiu) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p data-testid="saiu">Você saiu da conferência.</p>
        <Button
          onClick={() => {
            setSaiu(false);
            void motor
              .conferencias()
              .then((cs) =>
                setConf(cs.find((c) => c.unidade_id === LISTA && !encerrada(c.status))?.id ?? null),
              );
          }}
        >
          Abrir novamente
        </Button>
      </div>
    );
  }
  if (!conf) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p>Nenhuma conferência aberta nesta lista.</p>
        <Button
          className="h-12"
          onClick={() =>
            void motor
              .criarConferencia({ unidade_id: LISTA, conferente: "Conferente E2E" })
              .catch((e: Error) => setErro(e.message))
          }
        >
          INICIAR CONFERÊNCIA
        </Button>
      </div>
    );
  }
  return (
    <ConferenceScreen
      motor={motor}
      conferenciaId={conf}
      nomeLista="Lista de teste"
      ocultarEsperado={FAMILIA === "prateleira"}
      exigeGestor={FAMILIA === "caixa"}
      onSair={() => {
        setConf(null);
        setSaiu(true);
      }}
    />
  );
}

/** Todos os estados visuais lado a lado (claro e escuro), para o axe checar o contraste de
 * estados que na tela real aparecem só por um instante (ex.: SINCRONIZANDO). */
function Vitrine() {
  const estados = ["ONLINE", "OFFLINE", "SYNCING", "ERROR"] as const;
  const status = ["pendente", "conferido", "divergencia", "erro", "conflito"] as const;
  const bloco = (
    <div className="cr-alto-contraste space-y-2 bg-background p-4 text-foreground">
      {estados.map((estado) => (
        <ConferenceSyncBadge key={estado} resumo={{ ...RESUMO_VAZIO, estado, pendentes: 3 }} />
      ))}
      {status.map((s) => (
        <ConferenceStatusBadge key={s} status={s} adicionado />
      ))}
      {status.map((s) => (
        <ConferenceStatusBadge key={`c-${s}`} status={s} adicionado compacto />
      ))}
    </div>
  );
  return (
    <main>
      <h1>Vitrine</h1>
      <section aria-label="claro">{bloco}</section>
      <section aria-label="escuro" className="dark">
        {bloco}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {params.get("vitrine") ? <Vitrine /> : <App />}
    <Toaster position="top-center" />
  </StrictMode>,
);
