const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function dollars(n: number): string {
  return Math.abs(n) >= 1000 ? money0.format(n) : money2.format(n);
}

export function unitPrice(n: number, uom: 'EA' | 'FT'): string {
  return uom === 'FT' ? `${money2.format(n)}/ft` : money2.format(n);
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

export function weeks(n: number | null): string {
  if (n === null) return '—';
  return n === 0 ? 'Stock' : `${n} wk`;
}

export function vendorNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Vendor';
}
