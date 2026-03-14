import crypto from "node:crypto";
import { config } from "../config/index.js";
import type {
  CatalogCustomer,
  CatalogProduct,
  CatalogSnapshot,
  CreateSaleRequestBody,
  CreateSaleResponse,
  ParsedSaleDraft,
  VoiceSaleRequestContext,
} from "../types/contracts.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type GraphQlPayload<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type BusinessContextResult = {
  business: {
    id: string;
    name?: string | null;
    currency_code?: string | null;
    default_store_id?: string | null;
    sale_channels?: Array<{ id?: string | null; name?: string | null; code?: string | null }>;
  } | null;
};

type ProductsResult = {
  products: Array<{
    id: string;
    name: string;
    track_inventory?: boolean | null;
    default_stock_id?: string | null;
    default_stock?: {
      id?: string | null;
      name?: string | null;
      selling_price?: string | number | null;
      current_stock?: string | number | null;
    } | null;
    stocks?: Array<{
      id?: string | null;
      name?: string | null;
      selling_price?: string | number | null;
      current_stock?: string | number | null;
    }> | null;
  }>;
};

type CustomersResult = {
  customers: Array<{
    id: string;
    name: string;
    identifier?: string | null;
    phone?: string | null;
    email?: string | null;
    active?: boolean | null;
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

const BUSINESS_CONTEXT_QUERY = `
  query BusinessContext($where: BusinessWhereUniqueInput!) {
    business(where: $where) {
      id
      name
      currency_code
      default_store_id
      sale_channels {
        id
        name
        code
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query Products($where: ProductWhereInput, $take: Int) {
    products(where: $where, take: $take) {
      id
      name
      track_inventory
      default_stock_id
      default_stock {
        id
        name
        selling_price
        current_stock
      }
      stocks {
        id
        name
        selling_price
        current_stock
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

const toNumber = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeToken = (rawValue: string): string =>
  String(rawValue ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const generateShortNumber = (): string => String(Date.now()).slice(-6);

export class PitiXBackendAdapter {
  private async graphQlRequest<TData>(params: {
    endpoint: string;
    query: string;
    variables?: Record<string, unknown>;
    context: VoiceSaleRequestContext;
  }): Promise<TData> {
    const response = await fetch(params.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: normalizeToken(params.context.accessToken),
        token: normalizeToken(params.context.accessToken),
        "x-project-id": params.context.businessId,
        "x-user-id": params.context.userId,
      },
      body: JSON.stringify({
        query: params.query,
        variables: params.variables ?? {},
      }),
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as GraphQlPayload<TData>) : null;

    if (!response.ok) {
      throw new AppError(`PitiX backend request failed (${response.status}).`, {
        statusCode: 502,
        code: "pitix_backend_http_error",
        details: payload?.errors ?? text,
      });
    }

    if (payload?.errors?.length) {
      throw new AppError(payload.errors[0]?.message || "PitiX GraphQL error", {
        statusCode: 502,
        code: "pitix_graphql_error",
        details: payload.errors,
      });
    }

    if (!payload?.data) {
      throw new AppError("PitiX backend returned an empty response.", {
        statusCode: 502,
        code: "pitix_empty_response",
      });
    }

    return payload.data;
  }

  async fetchCatalog(context: VoiceSaleRequestContext): Promise<CatalogSnapshot> {
    const business = await this.graphQlRequest<BusinessContextResult>({
      endpoint: config.pitixPosGraphqlUrl,
      query: BUSINESS_CONTEXT_QUERY,
      variables: { where: { id: context.businessId } },
      context,
    });

    const [productsResult, customersResult] = await Promise.all([
      this.graphQlRequest<ProductsResult>({
        endpoint: config.pitixPosGraphqlUrl,
        query: PRODUCTS_QUERY,
        variables: {
          where: {
            business_id: { equals: context.businessId },
            active: { equals: true },
          },
          take: 200,
        },
        context,
      }),
      this.graphQlRequest<CustomersResult>({
        endpoint: config.pitixPosGraphqlUrl,
        query: CUSTOMERS_QUERY,
        variables: {
          where: {
            business_id: { equals: context.businessId },
            active: { equals: true },
          },
          take: 200,
        },
        context,
      }),
    ]);

    const products: CatalogProduct[] = (productsResult.products ?? []).map((product) => {
      const defaultStock = product.default_stock;
      const firstStock = product.stocks?.find((stock) => stock?.id) ?? defaultStock ?? null;
      return {
        id: product.id,
        name: product.name,
        trackInventory: Boolean(product.track_inventory),
        unitPrice: toNumber(defaultStock?.selling_price ?? firstStock?.selling_price),
        stockId: String(defaultStock?.id ?? firstStock?.id ?? "").trim() || null,
        currentStock: toNumber(defaultStock?.current_stock ?? firstStock?.current_stock),
      };
    });

    const customers: CatalogCustomer[] = (customersResult.customers ?? []).map((customer) => ({
      id: customer.id,
      name: customer.name,
      identifier: customer.identifier ?? null,
      phone: customer.phone ?? null,
      email: customer.email ?? null,
    }));

    logger.info("Catalog fetched", {
      requestId: context.requestId,
      businessId: context.businessId,
      productCount: products.length,
      customerCount: customers.length,
    });

    return {
      currencyCode: business.business?.currency_code || "MMK",
      defaultStoreId: business.business?.default_store_id || null,
      saleChannels:
        business.business?.sale_channels?.map((channel) => ({
          id: channel.id ?? undefined,
          name: channel.name || "AI Sales Assistant",
          code: channel.code ?? undefined,
        })) ?? [],
      customers,
      products,
    };
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

    const draft = body.draft;
    const matchedItems = draft.items.filter((item) => item.product);
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
    const saleStatus = body.saleOptions?.saleStatus ?? config.pitixDefaultSaleStatus;
    const storeId = body.storeId || context.storeId;
    if (!storeId) {
      throw new AppError("storeId is required to create a PitiX sale.", {
        statusCode: 400,
        code: "missing_store_id",
      });
    }

    const data = {
      id: crypto.randomUUID(),
      gross_amount: String(total),
      discount_amount: "0",
      charge_amount: "0",
      metadata: "",
      net_amount: String(total),
      note: draft.transcript,
      received_amount: saleStatus === "COMPLETED" ? String(total) : "0",
      refund_amount: "0",
      sale_channel: body.saleChannel?.name || context.saleChannelName || "AI Sales Assistant",
      sale_date: new Date(),
      sale_number: generateShortNumber(),
      operation_status: "Request",
      sale_status: saleStatus,
      seller_id: body.userId,
      seller_name: body.userId,
      shipping_amount: "0",
      tax_amount: "0",
      total_amount: String(total),
      is_point_eligible: Boolean(body.saleOptions?.isPointEligible),
      dining_option: body.saleOptions?.diningOption || "TakeAway",
      payment_method: body.paymentMethod?.name ?? undefined,
      payment_method_id: body.paymentMethod?.id ?? undefined,
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

    if (draft.customer?.id) {
      data.customer = {
        connect: {
          id: draft.customer.id,
        },
      };
    }

    const result = await this.graphQlRequest<CreateSaleResult>({
      endpoint: config.pitixPosGraphqlUrl,
      query: CREATE_ONE_SALE_MUTATION,
      variables: { data },
      context,
    });

    logger.info("Create sale request completed", {
      requestId: context.requestId,
      saleId: result.createOneSale2.id,
      saleNumber: result.createOneSale2.sale_number,
      saleStatus: result.createOneSale2.sale_status,
    });

    return {
      requestId: context.requestId,
      sale: {
        id: result.createOneSale2.id,
        saleNumber: result.createOneSale2.sale_number,
        saleStatus: result.createOneSale2.sale_status,
        totalAmount: toNumber(result.createOneSale2.net_amount),
        customerName: result.createOneSale2.customer?.name ?? null,
      },
      draft,
    };
  }
}

