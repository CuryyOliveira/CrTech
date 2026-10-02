/** Ligações React do motor V2 (somente leitura de estado; nenhuma regra aqui). */
import { useEffect, useState, useSyncExternalStore } from "react";
import { aoTrocarMotor, MotorSync, RESUMO_VAZIO, type ResumoSync } from "./index";

export function useMotorSync() {
  const [motor, setMotor] = useState<MotorSync | null>(null);
  const [resumo, setResumo] = useState<ResumoSync>(RESUMO_VAZIO);
  useEffect(() => aoTrocarMotor(setMotor), []);
  useEffect(() => {
    if (!motor) {
      setResumo(RESUMO_VAZIO);
      return;
    }
    return motor.observar(setResumo);
  }, [motor]);
  return { motor, resumo };
}

/** Resumo de um motor já conhecido (a tela de conferência recebe o motor por prop). */
export function useResumoMotor(motor: MotorSync) {
  const [resumo, setResumo] = useState<ResumoSync>(() => motor.resumo());
  useEffect(() => motor.observar(setResumo), [motor]);
  return resumo;
}

// Telas que mostram o próprio estado de sincronização (ex.: conferência) escondem o global.
let ocultos = 0;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((fn) => fn());

export function ocultarIndicadorGlobal() {
  ocultos++;
  avisar();
  return () => {
    ocultos = Math.max(0, ocultos - 1);
    avisar();
  };
}

export function useIndicadorGlobalVisivel() {
  return useSyncExternalStore(
    (fn) => {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
    () => ocultos === 0,
    () => true,
  );
}
