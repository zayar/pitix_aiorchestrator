import crypto from "node:crypto";
import { config } from "../config/index.js";
import type {
  CatalogCustomer,
  CatalogProduct,
  CatalogSnapshot,
  CreateSaleRequestBody,
  CreateSaleResponse,
  PitiXAccountAuthResult,
  PitiXBusinessSummary,
  PitiXPaymentMethod,
  PitiXProduct,
  PitiXProductQueryOptions,
  PitiXProductStock,
  PitiXSaleChannel,
  PitiXSession,
  PitiXTokenRefreshResponse,
  VoiceSaleRequestContext,
} from "../types/contracts.js";
import { AppError, isAppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { pitixGraphqlRequest } from "../utils/pitixGraphql.js";

type VerifyOtaResult = {
  verifyOTA: {
    data?: unknown;
    expiresIn?: string | number | null;
    refreshToken?: string | null;
    token?: string | null;
    tokenType?: string | null;
  } | null;
};

type RefreshTokenResult = {
  refreshToken: {
    token?: string | null;
    refreshToken?: string | null;
    tokenType?: string | null;
    expiresIn?: string | number | null;
  } | null;
};

type BusinessResult = {
  business: {
    id: string;
    name?: string | null;
    currency_code?: string | null;
    default_store_id?: string | null;
    stores?: Array<{
      id: string;
      name?: string | null;
    }> | null;
    sale_channels?: Array<{
      id?: string | null;
      name?: string | null;
      type?: string | null;
      code?: string | null;
    }> | null;
  } | null;
};

type BusinessPingResult = {
  business: {
    id: string;
    name?: string | null;
  } | null;
};

type SaleChannelsResult = {
  saleChannels: Array<{
    id: string;
    code?: string | null;
    is_default?: boolean | null;
    name?: string | null;
    type?: string | null;
    active?: boolean | null;
    store_id?: string | null;
    store?: {
      id?: string | null;
      name?: string | null;
    } | null;
  }>;
};

type PaymentMethodsResult = {
  paymentMethods: Array<{
    id: string;
    description?: string | null;
    name?: string | null;
    payment_code?: string | null;
    payment_currency?: string | null;
    metadata?: string | null;
    available_all_channel?: boolean | null;
    stores?: Array<{
      id: string;
      name?: string | null;
    }> | null;
  }>;
};

type ProductsResult = {
  products: Array<{
    id: string;
    name?: string | null;
    active?: boolean | null;
    available_all_channel?: boolean | null;
    track_inventory?: boolean | null;
    default_stock_id?: string | null;
    default_stock?: {
      id?: string | null;
      name?: string | null;
      selling_price?: string | number | null;
      current_stock?: string | number | null;
      store_id?: string | null;
      active?: boolean | null;
      is_deleted?: boolean | null;
    } | null;
    sale_channels?: Array<{
      id?: string | null;
      is_default?: boolean | null;
      name?: string | null;
      type?: string | null;
      code?: string | null;
      active?: boolean | null;
    }> | null;
    stocks?: Array<{
      id?: string | null;
      name?: string | null;
      selling_price?: string | number | null;
      current_stock?: string | number | null;
      store_id?: string | null;
      active?: boolean | null;
      is_deleted?: boolean | null;
    }> | null;
  }>;
};

type CustomersResult = {
  customers: Array<{
    id: string;
    name?: string | null;
    identifier?: string | null;
    phone?: string | null;
    email?: string | null;
    active?: boolean | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
};

type CreateSaleResult = {
  createOneSale2: {
    id: string;
    sale_number: string;
    sale_status: string;
    net_amount?: string | number | null;
    customer?: {
      name?: string | null;
    } | null;
  };
};

type ReceivedPaymentWithBulkResult = {
  receivedPaymentWithBulk: number | null;
};

type CatalogCacheEntry = {
  snapshot: CatalogSnapshot;
  cachedAt: number;
};

type RefreshedSessionEntry = {
  token: string;
  refreshToken?: string;
  refreshedAt: number;
};

const VERIFY_OTA_MUTATION = `
  mutation VerifyOTA($requestId: String!) {
    verifyOTA(requestId: $requestId) {
      data
      expiresIn
      refreshToken
      token
      tokenType
    }
  }
`;

const REFRESH_TOKEN_MUTATION = `
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      token
      refreshToken
      tokenType
      expiresIn
    }
  }
`;

const BUSINESS_QUERY = `
  query Business($where: BusinessWhereUniqueInput!) {
    business(where: $where) {
      id
      name
      currency_code
      default_store_id
      stores {
        id
        name
      }
      sale_channels {
        id
        name
        type
        code
      }
    }
  }
`;

const BUSINESS_PING_QUERY = `
  query BusinessPing($where: BusinessWhereUniqueInput!) {
    business(where: $where) {
      id
      name
    }
  }
`;

const SALE_CHANNELS_QUERY = `
  query SaleChannels($where: SaleChannelWhereInput, $take: Int, $skip: Int) {
    saleChannels(where: $where, take: $take, skip: $skip) {
      id
      code
      is_default
      name
      type
      active
      store_id
      store {
        id
        name
      }
      updated_at
      created_at
    }
  }
`;

const PAYMENT_METHODS_QUERY = `
  query PaymentMethods($where: PaymentMethodWhereInput, $skip: Int, $take: Int) {
    paymentMethods(where: $where, skip: $skip, take: $take) {
      id
      description
      name
      payment_code
      payment_currency
      metadata
      available_all_channel
      stores {
        id
        name
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query Products($where: ProductWhereInput, $take: Int, $skip: Int) {
    products(where: $where, take: $take, skip: $skip) {
      id
      name
      active
      available_all_channel
      default_stock_id
      track_inventory
      default_stock {
        id
        name
        selling_price
        current_stock
        store_id
        active
        is_deleted
      }
      sale_channels {
        id
        is_default
        name
        type
        code
        active
      }
      stocks {
        id
        name
        selling_price
        current_stock
        store_id
        active
        is_deleted
      }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query Customers($where: CustomerWhereInput, $take: Int) {
    customers(where: $where, take: $take) {
      id
      name
      identifier
      phone
      email
      active
      createdAt
      updatedAt
    }
  }
`;

const CREATE_ONE_SALE_MUTATION = `
  mutation CreateOneSale2($data: SaleCreateInput!) {
    createOneSale2(data: $data) {
      id
      sale_number
      sale_status
      net_amount
      customer {
        name
      }
    }
  }
`;

const RECEIVED_PAYMENT_WITH_BULK_MUTATION = `
  mutation ReceivedPaymentWithBulk(
    $data: [PaymentDetailCreateManyInput!]!
    $saleId: String
    $receivedAmount: Float
    $refundAmount: Float
  ) {
    receivedPaymentWithBulk(
      data: $data
      saleId: $saleId
      receivedAmount: $receivedAmount
      refundAmount: $refundAmount
    )
  }
`;

const toNumber = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeToken = (rawValue: string): string =>
  String(rawValue ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const generateShortNumber = (): string => String(Date.now()).slice(-6);

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const toTrimmedString = (value: unknown): string | undefined => {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
};

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogSnapshotCache = new Map<string, CatalogCacheEntry>();

const getCatalogCacheKey = (context: VoiceSaleRequestContext): string =>
  `${context.businessId}:${context.storeId || "default"}`;

const getAppErrorDetails = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const normalizeForLookup = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const mapSaleChannel = (channel: {
  id?: string | null;
  code?: string | null;
  active?: boolean | null;
  name?: string | null;
  is_default?: boolean | null;
  type?: string | null;
  store_id?: string | null;
  store?: { id?: string | null; name?: string | null } | null;
}): PitiXSaleChannel => ({
  id: String(channel.id ?? "").trim() || undefined,
  code: channel.code ?? null,
  active: channel.active ?? undefined,
  name: String(channel.name ?? "Unnamed channel").trim() || "Unnamed channel",
  isDefault: channel.is_default ?? undefined,
  type: channel.type ?? null,
  storeId: channel.store_id ?? channel.store?.id ?? null,
  storeName: channel.store?.name ?? null,
});

const mapProductStock = (stock: {
  id?: string | null;
  name?: string | null;
  selling_price?: string | number | null;
  current_stock?: string | number | null;
  store_id?: string | null;
  active?: boolean | null;
  is_deleted?: boolean | null;
} | null | undefined): PitiXProductStock | null => {
  if (!stock?.id) {
    return null;
  }

  return {
    id: stock.id,
    name: String(stock.name ?? "Unnamed stock").trim() || "Unnamed stock",
    sellingPrice: toNumber(stock.selling_price),
    currentStock: toNumber(stock.current_stock),
    storeId: stock.store_id ?? null,
    active: stock.active ?? undefined,
    isDeleted: stock.is_deleted ?? undefined,
  };
};

const mapProduct = (product: ProductsResult["products"][number]): PitiXProduct => {
  const defaultStock = mapProductStock(product.default_stock);
  const stocks = (product.stocks ?? [])
    .map((stock) => mapProductStock(stock))
    .filter((stock): stock is PitiXProductStock => Boolean(stock));

  return {
    id: product.id,
    name: String(product.name ?? "Unnamed product").trim() || "Unnamed product",
    active: Boolean(product.active ?? true),
    availableAllChannel: Boolean(product.available_all_channel),
    trackInventory: Boolean(product.track_inventory),
    defaultStockId: product.default_stock_id ?? defaultStock?.id ?? null,
    defaultStock,
    stocks,
    saleChannels: (product.sale_channels ?? []).map((item) => mapSaleChannel(item)),
  };
};

const filterChannelsForStore = (channels: PitiXSaleChannel[], storeId?: string): PitiXSaleChannel[] => {
  if (!storeId) {
    return channels;
  }

  const filtered = channels.filter((channel) => !channel.storeId || channel.storeId === storeId);
  return filtered.length > 0 ? filtered : channels;
};

const pickPreferredStock = (product: PitiXProduct, storeId?: string): PitiXProductStock | null => {
  if (storeId) {
    const storeStock =
      product.defaultStock?.storeId === storeId
        ? product.defaultStock
        : product.stocks.find((stock) => stock.storeId === storeId) ?? null;
    if (storeStock) {
      return storeStock;
    }
  }

  return product.defaultStock ?? product.stocks[0] ?? null;
};

const toCatalogProduct = (product: PitiXProduct, storeId?: string): CatalogProduct => {
  const preferredStock = pickPreferredStock(product, storeId);

  return {
    id: product.id,
    name: product.name,
    trackInventory: product.trackInventory,
    unitPrice: preferredStock?.sellingPrice ?? 0,
    stockId: preferredStock?.id ?? product.defaultStockId ?? null,
    currentStock: preferredStock?.currentStock ?? 0,
  };
};

const buildPosHeaders = (session: PitiXSession): HeadersInit => ({
  Authorization: normalizeToken(session.token),
  "x-project-id": session.businessId,
  "x-user-id": session.userId,
});

const mapVerifyOtaSession = (payload: unknown, token: string, refreshToken?: string): PitiXSession => {
  const record = toRecord(payload);
  const saleChannelRecord = toRecord(record.saleChannel);
  const saleChannelName = String(saleChannelRecord.name ?? "").trim();
  const saleChannel =
    saleChannelName || saleChannelRecord.id
      ? {
          id: String(saleChannelRecord.id ?? "").trim() || undefined,
          code: String(saleChannelRecord.code ?? "").trim() || null,
          active: typeof saleChannelRecord.active === "boolean" ? saleChannelRecord.active : undefined,
          name: saleChannelName || "Self Service",
          isDefault:
            typeof saleChannelRecord.is_default === "boolean"
              ? saleChannelRecord.is_default
              : typeof saleChannelRecord.isDefault === "boolean"
                ? saleChannelRecord.isDefault
                : undefined,
          type: String(saleChannelRecord.type ?? "").trim() || null,
        }
      : null;

  const session: PitiXSession = {
    token,
    refreshToken,
    businessId: String(record.businessId ?? record.business_id ?? "").trim(),
    storeId: String(record.storeId ?? record.store_id ?? "").trim() || undefined,
    storeName: String(record.storeName ?? record.store_name ?? "").trim() || undefined,
    userId: String(record.userId ?? record.user_id ?? "").trim(),
    userName: String(record.userName ?? record.user_name ?? "").trim() || undefined,
    saleChannel,
  };

  if (!session.businessId || !session.userId) {
    throw new AppError("verifyOTA returned incomplete session data.", {
      statusCode: 502,
      code: "pitix_invalid_auth_response",
      details: {
        expectedFields: ["businessId", "userId"],
      },
    });
  }

  return session;
};

export class PitiXBackendAdapter {
  private readonly refreshedSessionCache = new Map<string, RefreshedSessionEntry>();
  private readonly inFlightSessionRefreshes = new Map<string, Promise<RefreshedSessionEntry>>();

  private getSessionRefreshKey(session: PitiXSession): string {
    return `${session.businessId}:${session.userId}:${session.storeId || "default"}`;
  }

  private applyRefreshedSession(session: PitiXSession, refreshed: RefreshedSessionEntry): void {
    session.token = refreshed.token;
    session.refreshToken = refreshed.refreshToken ?? session.refreshToken;
  }

  private async refreshSessionSingleFlight(
    session: PitiXSession,
    params: {
      requestId?: string;
      operationName?: unknown;
    } = {},
  ): Promise<void> {
    if (!session.refreshToken) {
      throw new AppError("PitiX refresh token is missing for this session.", {
        statusCode: 401,
        code: "missing_refresh_token",
      });
    }

    const refreshKey = this.getSessionRefreshKey(session);
    const currentToken = normalizeToken(session.token);
    const currentRefreshToken = normalizeToken(session.refreshToken);
    const cached = this.refreshedSessionCache.get(refreshKey);

    if (
      cached &&
      ((normalizeToken(cached.token) && normalizeToken(cached.token) !== currentToken) ||
        (normalizeToken(cached.refreshToken ?? "") && normalizeToken(cached.refreshToken ?? "") !== currentRefreshToken))
    ) {
      logger.info("Reusing recently refreshed PitiX session token", {
        requestId: params.requestId,
        operationName: params.operationName,
        businessId: session.businessId,
        userId: session.userId,
        storeId: session.storeId,
        refreshedAt: cached.refreshedAt,
      });
      this.applyRefreshedSession(session, cached);
      return;
    }

    const existingRefresh = this.inFlightSessionRefreshes.get(refreshKey);
    if (existingRefresh) {
      logger.info("Awaiting in-flight PitiX session refresh", {
        requestId: params.requestId,
        operationName: params.operationName,
        businessId: session.businessId,
        userId: session.userId,
        storeId: session.storeId,
      });
      const refreshed = await existingRefresh;
      this.applyRefreshedSession(session, refreshed);
      return;
    }

    const refreshPromise = (async (): Promise<RefreshedSessionEntry> => {
      const refreshed = await this.refreshToken(String(session.refreshToken), params.requestId);
      const nextSession: RefreshedSessionEntry = {
        token: refreshed.token,
        refreshToken: refreshed.refreshToken ?? session.refreshToken,
        refreshedAt: Date.now(),
      };
      this.refreshedSessionCache.set(refreshKey, nextSession);
      return nextSession;
    })();

    this.inFlightSessionRefreshes.set(refreshKey, refreshPromise);

    try {
      const refreshed = await refreshPromise;
      this.applyRefreshedSession(session, refreshed);
    } finally {
      if (this.inFlightSessionRefreshes.get(refreshKey) === refreshPromise) {
        this.inFlightSessionRefreshes.delete(refreshKey);
      }
    }
  }

  private async requestAccount<TData>(params: {
    query: string;
    variables?: Record<string, unknown>;
    requestId?: string;
  }): Promise<TData> {
    return pitixGraphqlRequest<TData>({
      endpoint: config.pitixAccountGraphqlUrl,
      query: params.query,
      variables: params.variables,
      requestId: params.requestId,
    });
  }

  private async requestPos<TData>(params: {
    session: PitiXSession;
    query: string;
    variables?: Record<string, unknown>;
    requestId?: string;
    retryOnUnauthorized?: boolean;
  }): Promise<TData> {
    try {
      return await pitixGraphqlRequest<TData>({
        endpoint: config.pitixPosGraphqlUrl,
        query: params.query,
        variables: params.variables,
        headers: buildPosHeaders(params.session),
        requestId: params.requestId,
      });
    } catch (error) {
      const details = getAppErrorDetails(isAppError(error) ? error.details : undefined);
      const httpStatus = Number(details.httpStatus ?? 0);
      const shouldRetry =
        (params.retryOnUnauthorized ?? true) &&
        isAppError(error) &&
        error.code === "pitix_backend_http_error" &&
        httpStatus === 401 &&
        Boolean(params.session.refreshToken);

      if (!shouldRetry) {
        throw error;
      }

      logger.warn("PitiX POS request returned 401, attempting token refresh", {
        requestId: params.requestId,
        operationName: details.operationName,
        businessId: params.session.businessId,
        userId: params.session.userId,
        storeId: params.session.storeId,
        hasRefreshToken: Boolean(params.session.refreshToken),
      });

      await this.refreshSessionSingleFlight(params.session, {
        requestId: params.requestId,
        operationName: details.operationName,
      });

      logger.info("PitiX POS token refresh succeeded, retrying request", {
        requestId: params.requestId,
        operationName: details.operationName,
        businessId: params.session.businessId,
        userId: params.session.userId,
      });

      return this.requestPos<TData>({
        ...params,
        retryOnUnauthorized: false,
      });
    }
  }

  async verifyOTA(requestId: string, traceRequestId?: string): Promise<PitiXAccountAuthResult> {
    const result = await this.requestAccount<VerifyOtaResult>({
      query: VERIFY_OTA_MUTATION,
      variables: {
        requestId,
      },
      requestId: traceRequestId,
    });

    if (!result.verifyOTA?.token) {
      throw new AppError("verifyOTA did not return an access token.", {
        statusCode: 502,
        code: "pitix_invalid_auth_response",
      });
    }

    const session = mapVerifyOtaSession(
      result.verifyOTA.data,
      result.verifyOTA.token,
      result.verifyOTA.refreshToken ?? undefined,
    );

    logger.info("PitiX verifyOTA succeeded", {
      requestId: traceRequestId,
      businessId: session.businessId,
      storeId: session.storeId,
      userId: session.userId,
    });

    return {
      token: result.verifyOTA.token,
      refreshToken: result.verifyOTA.refreshToken ?? undefined,
      tokenType: result.verifyOTA.tokenType ?? null,
      expiresIn: result.verifyOTA.expiresIn != null ? String(result.verifyOTA.expiresIn) : null,
      session,
    };
  }

  async refreshToken(refreshToken: string, traceRequestId?: string): Promise<PitiXTokenRefreshResponse> {
    const result = await this.requestAccount<RefreshTokenResult>({
      query: REFRESH_TOKEN_MUTATION,
      variables: {
        refreshToken,
      },
      requestId: traceRequestId,
    });

    if (!result.refreshToken?.token) {
      throw new AppError("refreshToken did not return a new access token.", {
        statusCode: 502,
        code: "pitix_invalid_refresh_response",
      });
    }

    logger.info("PitiX refreshToken succeeded", {
      requestId: traceRequestId,
      hasRefreshToken: Boolean(result.refreshToken.refreshToken),
    });

    return {
      token: result.refreshToken.token,
      refreshToken: result.refreshToken.refreshToken ?? undefined,
      tokenType: result.refreshToken.tokenType ?? null,
      expiresIn: result.refreshToken.expiresIn != null ? String(result.refreshToken.expiresIn) : null,
    };
  }

  async getBusiness(session: PitiXSession, traceRequestId?: string): Promise<PitiXBusinessSummary | null> {
    const result = await this.requestPos<BusinessResult>({
      session,
      query: BUSINESS_QUERY,
      variables: {
        where: {
          id: session.businessId,
        },
      },
      requestId: traceRequestId,
    });

    if (!result.business) {
      logger.warn("PitiX business lookup returned no result", {
        requestId: traceRequestId,
        businessId: session.businessId,
      });
      return null;
    }

    const business: PitiXBusinessSummary = {
      id: result.business.id,
      name: String(result.business.name ?? "Unnamed business").trim() || "Unnamed business",
      currencyCode: result.business.currency_code ?? null,
      defaultStoreId: result.business.default_store_id ?? null,
      stores: (result.business.stores ?? []).map((store) => ({
        id: store.id,
        name: store.name ?? null,
      })),
      saleChannels: (result.business.sale_channels ?? []).map((channel) => mapSaleChannel(channel)),
    };

    logger.info("PitiX business fetched", {
      requestId: traceRequestId,
      businessId: business.id,
      storeCount: business.stores.length,
      saleChannelCount: business.saleChannels.length,
    });

    return business;
  }

  async pingBusiness(session: PitiXSession, traceRequestId?: string): Promise<{ id: string; name?: string | null } | null> {
    const result = await this.requestPos<BusinessPingResult>({
      session,
      query: BUSINESS_PING_QUERY,
      variables: {
        where: {
          id: session.businessId,
        },
      },
      requestId: traceRequestId,
    });

    logger.info("PitiX business ping completed", {
      requestId: traceRequestId,
      businessId: session.businessId,
      found: Boolean(result.business),
    });

    return result.business
      ? {
          id: result.business.id,
          name: result.business.name ?? null,
        }
      : null;
  }

  async getSaleChannels(session: PitiXSession, traceRequestId?: string): Promise<PitiXSaleChannel[]> {
    const result = await this.requestPos<SaleChannelsResult>({
      session,
      query: SALE_CHANNELS_QUERY,
      variables: {
        where: {
          business_id: {
            equals: session.businessId,
          },
          active: {
            equals: true,
          },
        },
        take: 100,
        skip: 0,
      },
      requestId: traceRequestId,
    });

    const saleChannels = filterChannelsForStore(
      (result.saleChannels ?? []).map((channel) => mapSaleChannel(channel)),
      session.storeId,
    );

    logger.info("PitiX sale channels fetched", {
      requestId: traceRequestId,
      businessId: session.businessId,
      storeId: session.storeId,
      saleChannelCount: saleChannels.length,
    });

    return saleChannels;
  }

  async getPaymentMethods(session: PitiXSession, traceRequestId?: string): Promise<PitiXPaymentMethod[]> {
    const result = await this.requestPos<PaymentMethodsResult>({
      session,
      query: PAYMENT_METHODS_QUERY,
      variables: {
        where: {
          business_id: {
            equals: session.businessId,
          },
        },
        take: 100,
        skip: 0,
      },
      requestId: traceRequestId,
    });

    let paymentMethods: PitiXPaymentMethod[] = (result.paymentMethods ?? []).map((item) => ({
      id: item.id,
      name: String(item.name ?? "Unnamed payment method").trim() || "Unnamed payment method",
      description: item.description ?? null,
      paymentCode: item.payment_code ?? null,
      paymentCurrency: item.payment_currency ?? null,
      availableAllChannel: Boolean(item.available_all_channel),
      metadata: item.metadata ?? null,
      stores: (item.stores ?? []).map((store) => ({
        id: store.id,
        name: store.name ?? null,
      })),
    }));

    if (session.storeId) {
      paymentMethods = paymentMethods.filter((method) =>
        method.stores.some((store) => store.id === session.storeId),
      );
    }

    logger.info("PitiX payment methods fetched", {
      requestId: traceRequestId,
      businessId: session.businessId,
      storeId: session.storeId,
      paymentMethodCount: paymentMethods.length,
    });

    return paymentMethods;
  }

  async getProducts(
    session: PitiXSession,
    options: PitiXProductQueryOptions = {},
    traceRequestId?: string,
  ): Promise<PitiXProduct[]> {
    const take = Math.max(1, Math.min(options.take ?? 50, 200));
    const skip = Math.max(options.skip ?? 0, 0);
    const where: Record<string, unknown> = {
      business_id: {
        equals: session.businessId,
      },
    };

    if (options.activeOnly ?? true) {
      where.active = {
        equals: true,
      };
    }

    const result = await this.requestPos<ProductsResult>({
      session,
      query: PRODUCTS_QUERY,
      variables: {
        where,
        take,
        skip,
      },
      requestId: traceRequestId,
    });

    const products = (result.products ?? []).map((product) => mapProduct(product));

    logger.info("PitiX products fetched", {
      requestId: traceRequestId,
      businessId: session.businessId,
      storeId: options.storeId ?? session.storeId,
      productCount: products.length,
      take,
      skip,
    });

    return products;
  }

  private async getCustomers(session: PitiXSession, traceRequestId?: string): Promise<CatalogCustomer[]> {
    const result = await this.requestPos<CustomersResult>({
      session,
      query: CUSTOMERS_QUERY,
      variables: {
        where: {
          business_id: {
            equals: session.businessId,
          },
        },
        take: 200,
      },
      requestId: traceRequestId,
    });

    const customers = (result.customers ?? []).map((customer) => ({
      id: customer.id,
      name: String(customer.name ?? "Unnamed customer").trim() || "Unnamed customer",
      identifier: customer.identifier ?? null,
      phone: customer.phone ?? null,
      email: customer.email ?? null,
      createdAt: customer.createdAt ?? null,
      updatedAt: customer.updatedAt ?? null,
    }));

    logger.info("PitiX customers fetched", {
      requestId: traceRequestId,
      businessId: session.businessId,
      customerCount: customers.length,
    });

    return customers;
  }

  async fetchCatalog(context: VoiceSaleRequestContext): Promise<CatalogSnapshot> {
    const cacheKey = getCatalogCacheKey(context);
    const cached = catalogSnapshotCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CATALOG_CACHE_TTL_MS) {
      logger.info("PitiX catalog snapshot cache hit", {
        requestId: context.requestId,
        businessId: context.businessId,
        storeId: context.storeId ?? null,
        ageMs: Date.now() - cached.cachedAt,
      });
      return cached.snapshot;
    }

    try {
      const [business, saleChannels, products, customers] = await Promise.all([
        this.getBusiness(context, context.requestId),
        this.getSaleChannels(context, context.requestId),
        this.getProducts(
          context,
          {
            take: 200,
            activeOnly: true,
            storeId: context.storeId,
          },
          context.requestId,
        ),
        this.getCustomers(context, context.requestId),
      ]);

      const preferredStoreId = context.storeId ?? business?.defaultStoreId ?? undefined;

      logger.info("PitiX catalog snapshot prepared", {
        requestId: context.requestId,
        businessId: context.businessId,
        preferredStoreId,
        saleChannelCount: saleChannels.length,
        productCount: products.length,
        customerCount: customers.length,
      });

      const snapshot = {
        currencyCode: business?.currencyCode || "MMK",
        defaultStoreId: business?.defaultStoreId ?? null,
        saleChannels,
        customers,
        products: products.map((product) => toCatalogProduct(product, preferredStoreId)),
      };

      catalogSnapshotCache.set(cacheKey, {
        snapshot,
        cachedAt: Date.now(),
      });

      return snapshot;
    } catch (error) {
      if (cached) {
        logger.warn("PitiX catalog live fetch failed, using cached snapshot", {
          requestId: context.requestId,
          businessId: context.businessId,
          storeId: context.storeId ?? null,
          error: error instanceof Error ? error.message : String(error),
          cachedAgeMs: Date.now() - cached.cachedAt,
        });
        return cached.snapshot;
      }

      throw error;
    }
  }

  private async resolvePaymentMethodForCreate(params: {
    session: PitiXSession;
    requested?: CreateSaleRequestBody["paymentMethod"];
    requestId?: string;
  }): Promise<{ id: string; name: string; source: "request" | "lookup" | "default_cash" }> {
    const requestedId = toTrimmedString(params.requested?.id);
    const requestedName = toTrimmedString(params.requested?.name);
    const availableMethods = await this.getPaymentMethods(params.session, params.requestId);
    const requestedNameKey = normalizeForLookup(requestedName);

    let resolvedMethod: PitiXPaymentMethod | undefined;
    if (requestedId) {
      resolvedMethod = availableMethods.find((method) => method.id === requestedId);
    }
    if (!resolvedMethod && requestedNameKey) {
      resolvedMethod = availableMethods.find((method) => normalizeForLookup(method.name) === requestedNameKey);
    }
    if (!resolvedMethod && requestedNameKey) {
      resolvedMethod = availableMethods.find((method) => normalizeForLookup(method.paymentCode) === requestedNameKey);
    }
    if (!resolvedMethod && !requestedId && !requestedNameKey) {
      resolvedMethod =
        availableMethods.find((method) => normalizeForLookup(method.name) === "cash") ??
        availableMethods.find((method) => normalizeForLookup(method.paymentCode) === "cash") ??
        availableMethods.find((method) => normalizeForLookup(method.name).includes("cash"));
    }

    if (!resolvedMethod) {
      throw new AppError("Unable to resolve a valid PitiX payment method for this sale.", {
        statusCode: 400,
        code: "payment_method_not_found",
        details: {
          businessId: params.session.businessId,
          storeId: params.session.storeId ?? null,
          requestedPaymentMethodId: requestedId ?? null,
          requestedPaymentMethodName: requestedName ?? "Cash",
        },
      });
    }

    return {
      id: resolvedMethod.id,
      name: resolvedMethod.name,
      source: requestedId && requestedName && resolvedMethod.id === requestedId ? "request" : requestedId || requestedName ? "lookup" : "default_cash",
    };
  }

  private async recordSalePayment(params: {
    session: PitiXSession;
    saleId: string;
    amount: number;
    paymentMethodId: string;
    paymentMethodName: string;
    sellerName: string;
    requestId?: string;
  }): Promise<number> {
    const result = await this.requestPos<ReceivedPaymentWithBulkResult>({
      session: params.session,
      query: RECEIVED_PAYMENT_WITH_BULK_MUTATION,
      variables: {
        data: [
          {
            sale_id: params.saleId,
            payment_date: new Date().toISOString(),
            payment_method: params.paymentMethodName,
            payment_method_id: params.paymentMethodId,
            amount: String(params.amount),
            payment_note: "AI Sales Assistant cash checkout",
            username: params.sellerName,
            user_id: params.session.userId,
          },
        ],
        saleId: params.saleId,
        receivedAmount: params.amount,
        refundAmount: 0,
      },
      requestId: params.requestId,
    });

    const createdCount = Number(result.receivedPaymentWithBulk ?? 0);
    if (!Number.isFinite(createdCount) || createdCount <= 0) {
      throw new AppError("Sale was created but payment finalization did not create a payment detail.", {
        statusCode: 502,
        code: "payment_finalize_failed",
        details: {
          saleId: params.saleId,
          paymentMethodId: params.paymentMethodId,
          paymentMethodName: params.paymentMethodName,
        },
      });
    }

    return createdCount;
  }

  async createSale(
    context: VoiceSaleRequestContext,
    body: CreateSaleRequestBody,
  ): Promise<CreateSaleResponse> {
    if (!body.confirmed) {
      throw new AppError("Sale creation requires explicit confirmation.", {
        statusCode: 400,
        code: "confirmation_required",
      });
    }

    const matchedItems = body.draft.items.filter((item) => item.product);
    if (matchedItems.length === 0) {
      throw new AppError("At least one matched product is required to create a sale.", {
        statusCode: 400,
        code: "no_matched_items",
      });
    }

    const missingStock = matchedItems.find((item) => !item.product?.stockId);
    if (missingStock) {
      throw new AppError(`Product "${missingStock.product?.name}" is missing a stock id.`, {
        statusCode: 400,
        code: "missing_stock_id",
      });
    }

    const total = matchedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const storeId = body.storeId || context.storeId;
    if (!storeId) {
      throw new AppError("storeId is required to create a PitiX sale.", {
        statusCode: 400,
        code: "missing_store_id",
      });
    }

    const saleSession: VoiceSaleRequestContext = {
      ...context,
      storeId,
    };
    const resolvedPaymentMethod = await this.resolvePaymentMethodForCreate({
      session: saleSession,
      requested: body.paymentMethod,
      requestId: context.requestId,
    });
    const saleStatus = body.saleOptions?.saleStatus ?? "COMPLETED";
    const isDraftSale = saleStatus === "PENDING";
    const saleChannelName = toTrimmedString(body.saleChannel?.name) ?? context.saleChannel?.name ?? "AI Sales Assistant";
    const sellerName = toTrimmedString(context.userName) ?? body.userId;
    const diningOption = body.saleOptions?.diningOption || "TakeAway";
    const receivedAmount = saleStatus === "COMPLETED" ? String(total) : "0";

    logger.info("Preparing PitiX create sale payload", {
      requestId: context.requestId,
      businessId: body.businessId,
      storeId,
      userId: body.userId,
      sellerName,
      saleChannel: saleChannelName,
      saleStatus,
      itemCount: matchedItems.length,
      paymentMethodName: resolvedPaymentMethod.name,
      hasPaymentMethodId: Boolean(resolvedPaymentMethod.id),
      paymentMethodSource: resolvedPaymentMethod.source,
      diningOption,
      receivedAmount,
      paymentStatus: isDraftSale ? "UNPAID" : "PAID",
      operationStatus: isDraftSale ? "None" : "Request",
    });

    const data = {
      id: crypto.randomUUID(),
      gross_amount: String(total),
      discount_amount: "0",
      charge_amount: "0",
      metadata: "",
      net_amount: String(total),
      note: body.draft.transcript,
      received_amount: receivedAmount,
      refund_amount: "0",
      sale_channel: saleChannelName,
      sale_date: new Date(),
      sale_number: generateShortNumber(),
      operation_status: isDraftSale ? "None" : "Request",
      payment_status: isDraftSale ? "UNPAID" : undefined,
      sale_status: saleStatus,
      seller_id: body.userId,
      seller_name: sellerName,
      shipping_amount: "0",
      tax_amount: "0",
      total_amount: String(total),
      is_point_eligible: Boolean(body.saleOptions?.isPointEligible),
      dining_option: diningOption,
      payment_method: resolvedPaymentMethod.name,
      payment_method_id: resolvedPaymentMethod.id,
      business: {
        connect: {
          id: body.businessId,
        },
      },
      store: {
        connect: {
          id: storeId,
        },
      },
      items: {
        create: matchedItems.map((item) => ({
          id: crypto.randomUUID(),
          image: "",
          name: item.product?.name || item.rawText,
          gross_amount: String(item.lineTotal),
          discount_amount: "0",
          cost_price: "0",
          net_amount: String(item.lineTotal),
          optional_amount: "0",
          quantity: item.quantity,
          stock_id: item.product?.stockId,
          tax_amount: "0",
          thumbnail_image: "",
          total_amount: String(item.lineTotal),
          unit_price: String(item.unitPrice),
          use_inventory: Boolean(item.product?.trackInventory),
        })),
      },
    } as Record<string, unknown>;

    if (body.draft.customer?.id) {
      data.customer = {
        connect: {
          id: body.draft.customer.id,
        },
      };
    }

    const result = await this.requestPos<CreateSaleResult>({
      session: saleSession,
      query: CREATE_ONE_SALE_MUTATION,
      variables: {
        data,
      },
      requestId: context.requestId,
    });

    let paymentDetailsCreated = 0;
    if (saleStatus === "COMPLETED") {
      paymentDetailsCreated = await this.recordSalePayment({
        session: saleSession,
        saleId: result.createOneSale2.id,
        amount: total,
        paymentMethodId: resolvedPaymentMethod.id,
        paymentMethodName: resolvedPaymentMethod.name,
        sellerName,
        requestId: context.requestId,
      });
    }

    logger.info("PitiX create sale completed", {
      requestId: context.requestId,
      saleId: result.createOneSale2.id,
      saleNumber: result.createOneSale2.sale_number,
      saleStatus: result.createOneSale2.sale_status,
      paymentStatus: saleStatus === "COMPLETED" ? "PAID" : "UNPAID",
      paymentMethodName: resolvedPaymentMethod.name,
      hasPaymentMethodId: Boolean(resolvedPaymentMethod.id),
      receivedAmount,
      paymentDetailsCreated,
    });

    return {
      requestId: context.requestId,
      sale: {
        id: result.createOneSale2.id,
        saleNumber: result.createOneSale2.sale_number,
        saleStatus: result.createOneSale2.sale_status,
        totalAmount: toNumber(result.createOneSale2.net_amount),
        customerName: result.createOneSale2.customer?.name ?? null,
        paymentStatus: saleStatus === "COMPLETED" ? "PAID" : "UNPAID",
        paymentMethod: resolvedPaymentMethod.name,
        paymentMethodId: resolvedPaymentMethod.id,
      },
      draft: body.draft,
    };
  }
}
