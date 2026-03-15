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

export const buildCatalogBiasPhrases = (catalog: CatalogSnapshot): string[] => {
  const values = new Set<string>(DEFAULT_COMMANDS);

  for (const customer of catalog.customers) {
    const name = String(customer.name ?? "").trim();
    if (name) {
      values.add(name);
    }
    const identifier = String(customer.identifier ?? "").trim();
    if (identifier) {
      values.add(identifier);
    }
    const phone = String(customer.phone ?? "").trim();
    if (phone) {
      values.add(phone);
    }
  }

  for (const product of catalog.products) {
    const name = String(product.name ?? "").trim();
    if (name) {
      values.add(name);
    }
  }

  for (const saleChannel of catalog.saleChannels) {
    const name = String(saleChannel.name ?? "").trim();
    if (name) {
      values.add(name);
    }
  }

  return Array.from(values).slice(0, 1200);
};
