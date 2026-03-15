export type PitiXSaleChannel = {
  id?: string;
  code?: string | null;
  active?: boolean;
  name: string;
  isDefault?: boolean;
  type?: string | null;
  storeId?: string | null;
  storeName?: string | null;
};

export type PitiXSession = {
  token: string;
  refreshToken?: string;
  businessId: string;
  userId: string;
  storeId?: string;
  storeName?: string;
  userName?: string;
  saleChannel?: PitiXSaleChannel | null;
};

export type VoiceSaleRequestContext = PitiXSession & {
  requestId: string;
};

export type PitiXAccountAuthResult = {
  token: string;
  refreshToken?: string;
  tokenType?: string | null;
  expiresIn?: string | null;
  session: PitiXSession;
};

export type PitiXTokenRefreshResponse = {
  token: string;
  refreshToken?: string;
  tokenType?: string | null;
  expiresIn?: string | null;
};

export type PitiXStoreSummary = {
  id: string;
  name?: string | null;
};

export type PitiXBusinessSummary = {
  id: string;
  name: string;
  currencyCode?: string | null;
  defaultStoreId?: string | null;
  stores: PitiXStoreSummary[];
  saleChannels: PitiXSaleChannel[];
};

export type PitiXPaymentMethod = {
  id: string;
  name: string;
  description?: string | null;
  paymentCode?: string | null;
  paymentCurrency?: string | null;
  availableAllChannel?: boolean;
  metadata?: string | null;
  stores: PitiXStoreSummary[];
};

export type PitiXProductStock = {
  id: string;
  name: string;
  sellingPrice: number;
  currentStock: number;
  storeId?: string | null;
  active?: boolean;
  isDeleted?: boolean;
};

export type PitiXProduct = {
  id: string;
  name: string;
  active: boolean;
  availableAllChannel?: boolean;
  trackInventory: boolean;
  defaultStockId?: string | null;
  defaultStock?: PitiXProductStock | null;
  stocks: PitiXProductStock[];
  saleChannels: PitiXSaleChannel[];
};

export type PitiXProductQueryOptions = {
  take?: number;
  skip?: number;
  activeOnly?: boolean;
  storeId?: string;
};

export type TestAccountRequestBody = {
  requestId?: string;
  refreshToken?: string;
};

export type TestPosReadRequestBody = {
  token?: string;
  refreshToken?: string;
  businessId: string;
  userId: string;
  storeId?: string;
  storeName?: string;
  userName?: string;
  saleChannelName?: string;
  productLimit?: number;
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
  saleChannels: PitiXSaleChannel[];
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
  saleChannel?: Partial<PitiXSaleChannel>;
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
