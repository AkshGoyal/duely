// Money is stored in paise; dates are 'YYYY-MM-DD' strings in Asia/Kolkata.

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => Math.round(paise) / 100;

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
export const formatINR = (paise: number) => inr.format(toRupees(paise));

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

const dayMs = 86_400_000;
const utcDay = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

export const daysBetween = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / dayMs);

export function addDays(d: string, n: number): string {
  return new Date(utcDay(d) + n * dayMs).toISOString().slice(0, 10);
}

export const daysOverdue = (dueDate: string, today = todayIST()) => Math.max(0, daysBetween(dueDate, today));

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(utcDay(s)).toISOString().slice(0, 10) === s;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(utcDay(d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Digits for wa.me: 10-digit Indian numbers get a 91 prefix. */
export function phoneDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}
