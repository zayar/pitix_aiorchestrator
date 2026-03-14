export type VoiceSaleRequestContext = {
  requestId: string;
  businessId: string;
  storeId?: string;
  userId: string;
  accessToken: string;
  saleChannelName?: string;
};

export type CatalogCustomer = {
  id: string;
  name: string;
  identifier?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type CatalogProduct = {
  id: string;
  name: string;
  trackInventory: boolean;
  unitPrice: number;
  stockId?: string | null;
  currentStock?: number | null;
};

export type CatalogSnapshot = {
  currencyCode: string;
  defaultStoreId?: string | null;
  saleChannels: Array<{ id?: string; name: string; code?: string }>;
  customers: CatalogCustomer[];
  products: CatalogProduct[];
};

export type DraftMatchedCustomer = {
  id: string;
  name: string;
  identifier?: string | null;
  confidence: number;
  matchedText?: string | null;
};

export type DraftMatchedProduct = {
  id: string;
  name: string;
  confidence: number;
  unitPrice: number;
  stockId?: string | null;
  currentStock?: number | null;
  trackInventory?: boolean;
  matchedText?: string | null;
};

export type DraftSaleItem = {
  rawText: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: DraftMatchedProduct | null;
  warnings: string[];
};

export type ParsedSaleDraft = {
  transcript: string;
  customer: DraftMatchedCustomer | null;
  items: DraftSaleItem[];
  subtotal: number;
  currencyCode: string;
  warnings: string[];
  unmatchedPhrases: string[];
  confidence: number;
  needsClarification: boolean;
  recommendedNextAction: "review_and_confirm" | "review_and_clarify";
};

export type VoiceSaleProcessResponse = {
  requestId: string;
  transcript: string;
  draft: ParsedSaleDraft;
  meta: {
    speechProvider: string;
    parserProvider: string;
    recognizedLanguage: string;
    lowConfidence: boolean;
    createdAt: string;
  };
};

export type CreateSaleRequestBody = {
  businessId: string;
  storeId?: string;
  userId: string;
  confirmed: boolean;
  draft: ParsedSaleDraft;
  saleChannel?: {
    name?: string;
  };
  saleOptions?: {
    saleStatus?: "PENDING" | "COMPLETED";
    diningOption?: "TakeAway" | "DineIn";
    isPointEligible?: boolean;
  };
  paymentMethod?: {
    id?: string;
    name?: string;
  };
};

export type CreateSaleResponse = {
  requestId: string;
  sale: {
    id: string;
    saleNumber: string;
    saleStatus: string;
    totalAmount: number;
    customerName?: string | null;
  };
  draft: ParsedSaleDraft;
};

