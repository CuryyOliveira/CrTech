/**
 * Fotos do item: TIRAR FOTO (câmera) e ESCOLHER DA GALERIA. Cada foto entra na fila do motor V2
 * (MotorSync.adicionarFoto); o arquivo local só é liberado depois que o servidor confirma.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MotorSync } from "@/lib/sync-v2";
import type { FotoLocal } from "@/lib/sync-v2/tipos";
import { executar } from "./useConferenciaV2";

/** Redimensiona e comprime no aparelho (JPEG ~0,7) antes de guardar. */
export async function prepararFoto(arquivo: File, max = 1280): Promise<ArrayBuffer> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => erro(new Error("Não foi possível ler a imagem."));
      i.src = url;
    });
    const escala = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * escala));
    canvas.height = Math.max(1, Math.round(img.height * escala));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.7));
    if (!blob) throw new Error("Não foi possível processar a foto.");
    return await lerComoArrayBuffer(blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Blob → ArrayBuffer (FileReader: funciona também em WebViews antigos sem Blob.arrayBuffer). */
export function lerComoArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(leitor.result as ArrayBuffer);
    leitor.onerror = () => erro(leitor.error ?? new Error("Falha ao ler a foto."));
    leitor.readAsArrayBuffer(blob);
  });
}

const ROTULO: Record<FotoLocal["status"], { texto: string; icone: typeof Camera }> = {
  pendente_upload: { texto: "ENVIANDO", icone: Loader2 },
  enviando: { texto: "ENVIANDO", icone: Loader2 },
  enviada: { texto: "ENVIADA", icone: CheckCircle2 },
  confirmada: { texto: "ENVIADA", icone: CheckCircle2 },
  erro: { texto: "ERRO", icone: TriangleAlert },
};

export const ConferencePhotos = memo(function ConferencePhotos({
  motor,
  conferenciaId,
  itemK,
  fotos,
  desabilitado,
}: {
  motor: MotorSync;
  conferenciaId: string;
  itemK: string;
  fotos: FotoLocal[];
  desabilitado?: boolean;
}) {
  const [ocupado, setOcupado] = useState(false);
  const minhas = useMemo(() => fotos.filter((f) => f.item_k === itemK), [fotos, itemK]);

  async function adicionar(lista: FileList | null) {
    if (!lista?.length) return;
    setOcupado(true);
    try {
      for (const arquivo of Array.from(lista)) {
        await executar(async () => {
          const dados = await prepararFoto(arquivo);
          return motor.adicionarFoto(conferenciaId, itemK, dados, "image/jpeg");
        }, "Foto guardada. Será enviada automaticamente.");
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section aria-label="Fotos do item" className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 gap-2"
          disabled={desabilitado || ocupado}
          asChild
        >
          <label>
            <Camera className="size-5" aria-hidden /> TIRAR FOTO
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={desabilitado || ocupado}
              data-testid="foto-camera"
              onChange={(e) => {
                void adicionar(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 gap-2"
          disabled={desabilitado || ocupado}
          asChild
        >
          <label>
            <ImagePlus className="size-5" aria-hidden /> GALERIA
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={desabilitado || ocupado}
              data-testid="foto-galeria"
              onChange={(e) => {
                void adicionar(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
      </div>
      {minhas.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {minhas.map((f) => (
            <Miniatura key={f.id} foto={f} />
          ))}
        </ul>
      )}
    </section>
  );
});

function Miniatura({ foto }: { foto: FotoLocal }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!foto.arquivo) return;
    const u = URL.createObjectURL(new Blob([foto.arquivo], { type: foto.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto.arquivo, foto.mime]);
  const r = ROTULO[foto.status];
  const Icone = r.icone;
  return (
    <li
      className="w-24 overflow-hidden rounded-md border text-center"
      data-testid="foto-item"
      data-status={foto.status}
    >
      {url ? (
        <img src={url} alt="Foto do item" className="size-24 object-cover" />
      ) : (
        <div className="flex size-24 items-center justify-center bg-muted">
          <Camera className="size-6 text-muted-foreground" aria-hidden />
        </div>
      )}
      <p className="flex items-center justify-center gap-1 py-0.5 text-[10px] font-bold">
        <Icone
          className={`size-3 ${foto.status === "enviando" ? "animate-spin" : ""}`}
          aria-hidden
        />
        {r.texto}
      </p>
    </li>
  );
}
