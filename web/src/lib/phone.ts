/** Mantém só dígitos (máx. 11: DDD + número). */
export const phoneDigits = (v: string) => v.replace(/\D/g, '').slice(0, 11);

/** Máscara (99) 99999-9999 enquanto digita (aceita também fixo: (99) 9999-9999). */
export function maskPhone(v: string): string {
  const d = phoneDigits(v);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Celular completo: (99) 99999-9999 */
export const isValidPhone = (v: string) => /^\(\d{2}\) 9\d{4}-\d{4}$/.test(maskPhone(v));
