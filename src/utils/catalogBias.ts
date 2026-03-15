import type { CatalogSnapshot } from "../types/contracts.js";

const DEFAULT_COMMANDS = [
  "add sale",
  "sale order",
  "customer",
  "cash",
  "take away",
  "dine in",
  "ထည့်",
  "ရောင်း",
  "ဖောက်သည်",
];

const looksLikeOpaqueId = (value: string): boolean => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return false;
  }

  if (/^[a-z]{2,}\d[a-z0-9_-]{8,}$/i.test(trimmed)) {
    return true;
  }

  if (/^[a-f0-9_-]{16,}$/i.test(trimmed)) {
    return true;
  }

  return false;
};

const isUsefulSpokenPhrase = (value: string): boolean => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length < 2 || trimmed.length > 64) {
    return false;
  }

  if (/\(deleted\)/i.test(trimmed)) {
    return false;
  }

  if (looksLikeOpaqueId(trimmed)) {
    return false;
  }

  return /[\p{Script=Myanmar}A-Za-z]/u.test(trimmed);
};

export const buildCatalogBiasPhrases = (catalog: CatalogSnapshot): string[] => {
  const values = new Set<string>(DEFAULT_COMMANDS);

  for (const customer of catalog.customers) {
    const name = String(customer.name ?? "").trim();
    if (isUsefulSpokenPhrase(name)) {
      values.add(name);
    }
  }

  for (const product of catalog.products) {
    const name = String(product.name ?? "").trim();
    if (isUsefulSpokenPhrase(name)) {
      values.add(name);
    }
  }

  for (const saleChannel of catalog.saleChannels) {
    const name = String(saleChannel.name ?? "").trim();
    if (isUsefulSpokenPhrase(name)) {
      values.add(name);
    }
  }

  return Array.from(values).slice(0, 1200);
};
