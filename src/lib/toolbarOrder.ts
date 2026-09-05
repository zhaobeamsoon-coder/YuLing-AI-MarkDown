export const TOOLBAR_ORDER_KEY = "yuling-toolbar-order-v1";

export function normalizeToolbarOrder(value: string | null, defaults: string[]): string[] {
  if (!value) return defaults.slice();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return defaults.slice();
    const known = new Set(defaults);
    const seen = new Set<string>();
    const saved = parsed.filter((item) => known.has(item) && !seen.has(item) && Boolean(seen.add(item)));
    return [...saved, ...defaults.filter((item) => !seen.has(item))];
  } catch {
    return defaults.slice();
  }
}

export function moveToolbarItem(order: string[], source: string, target: string, after = false): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order.slice();
  const next = order.filter((id) => id !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next;
}
