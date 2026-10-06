import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react";

/** Texto + ícone + cor de cada estado (nunca só cor). */
export const ESTILO_ESTADO = {
  ONLINE: {
    icone: Wifi,
    texto: "ONLINE",
    classe: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/40",
  },
  OFFLINE: {
    icone: CloudOff,
    texto: "OFFLINE",
    classe: "bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-600/40",
  },
  SYNCING: {
    icone: RefreshCw,
    texto: "SINCRONIZANDO",
    classe: "bg-primary/15 text-primary border-primary/40",
  },
  ERROR: {
    icone: AlertTriangle,
    texto: "ERRO",
    classe: "bg-destructive/15 text-destructive border-destructive/40",
  },
} as const;
