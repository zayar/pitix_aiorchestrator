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
  createdAt?: string | null;
  updatedAt?: string | null;
  branchName?: string | null;
  companyName?: string | null;
  lastVisitAt?: string | null;
  purchaseCount?: number | null;
  totalSpend?: number | null;
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
  phone?: string | null;
  email?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  confidence: number;
  matchedText?: string | null;
};

export type CustomerMatchState =
  | "exact_unique_match"
  | "duplicate_name_match"
  | "suggested_match_only"
  | "no_match";

export type CustomerMatchCandidate = {
  id: string;
  name: string;
  identifier?: string | null;
  phone?: string | null;
  email?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  branchName?: string | null;
  companyName?: string | null;
  lastVisitAt?: string | null;
  purchaseCount?: number | null;
  totalSpend?: number | null;
  confidence?: number | null;
  matchReason?: string | null;
};

export type CustomerMatchInfo = {
  state: CustomerMatchState;
  spokenName?: string | null;
  helperText?: string | null;
  confidence?: number | null;
  suggestedMatches: CustomerMatchCandidate[];
  allMatches: CustomerMatchCandidate[];
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
  customerMatch: CustomerMatchInfo;
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
    paymentStatus?: "PAID" | "UNPAID";
    paymentMethod?: string | null;
    paymentMethodId?: string | null;
  };
  draft: ParsedSaleDraft;
};

export type SavedCartItemPayload = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  stock_id?: string | null;
  use_inventory?: boolean;
};

export type SavedVoiceCartDocument = {
  id: string;
  name: string;
  notes?: string | null;
  refName: string;
  refId: string;
  business_id: string;
  store_id: string;
  store_name?: string | null;
  user_id: string;
  user_name?: string | null;
  sale_channel?: string | null;
  currency_code: string;
  transcript: string;
  customer?: DraftMatchedCustomer | null;
  cartItem: SavedCartItemPayload[];
  items: DraftSaleItem[];
  gross_amount: number;
  discount_amount: number;
  charge_amount: number;
  net_amount: number;
  total_amount: number;
  tax_amount: number;
  shipping_amount: number;
  received_amount: number;
  refund_amount: number;
  total_quantity: number;
  is_saved: true;
  createdAt: string;
  updatedAt: string;
  draft: ParsedSaleDraft;
};

export type SavedCartListResponse = {
  requestId: string;
  carts: SavedVoiceCartDocument[];
};

export type SavedCartMutationResponse = {
  requestId: string;
  cart: SavedVoiceCartDocument;
};

export type SavedCartListRequestBody = {
  businessId: string;
  userId: string;
  storeId?: string;
  storeName?: string;
  userName?: string;
  refreshToken?: string;
  saleChannel?: string | { name?: string | null };
};

export type SavedCartMutationRequestBody = SavedCartListRequestBody & {
  cart: SavedVoiceCartDocument;
};
