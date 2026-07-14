import type { NotaInput } from "./grades.types.js";

export function calcularPromedioPonderado(notas: NotaInput[]): number {
  // Guard redundante y a la vez legible: con `notas` vacío el bucle de abajo deja
  // `suma = 0` y retorna 0 igual. Por eso mutar esta condición genera un MUTANTE
  // EQUIVALENTE (mismo resultado con o sin el guard), imposible de matar con un
  // test; se excluye de la mutación con la directiva oficial de Stryker.
  // Stryker disable next-line ConditionalExpression
  if (notas.length === 0) return 0;
  let suma = 0;
  for (const n of notas) {
    suma += n.valor * (n.peso / 100);
  }
  return suma;
}

export function sumaDePesos(notas: NotaInput[]): number {
  return notas.reduce((sum, n) => sum + n.peso, 0);
}
