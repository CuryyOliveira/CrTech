import {
  Book,
  Boxes,
  Car,
  FlaskConical,
  HardHat,
  Monitor,
  Package,
  Pill,
  Shirt,
  ShoppingCart,
  Stethoscope,
  Truck,
  Utensils,
  Warehouse,
  Wrench,
} from "lucide-react";

const MAPA = {
  package: Package,
  boxes: Boxes,
  truck: Truck,
  wrench: Wrench,
  pill: Pill,
  stethoscope: Stethoscope,
  car: Car,
  shirt: Shirt,
  utensils: Utensils,
  warehouse: Warehouse,
  cart: ShoppingCart,
  book: Book,
  hardhat: HardHat,
  flask: FlaskConical,
  monitor: Monitor,
} as const;

/** Ícone do módulo resolvido pelo nome salvo no banco (fallback: pacote). */
export function IconeModulo({ nome, className }: { nome?: string | null; className?: string }) {
  const Icone = MAPA[(nome ?? "package") as keyof typeof MAPA] ?? Package;
  return <Icone className={className} />;
}
