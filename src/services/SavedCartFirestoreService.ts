import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config } from "../config/index.js";
import type { SavedVoiceCartDocument } from "../types/contracts.js";

const FIREBASE_APP_NAME = "ai-orchestrator-pitix";

const getFirebaseApp = () => {
  const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  if (existing) {
    return existing;
  }

  return initializeApp(
    {
      credential: applicationDefault(),
      projectId: config.gcpProjectId || undefined,
    },
    FIREBASE_APP_NAME,
  );
};

const normalizeFirestoreDb = (value?: string): "production" | "development" =>
  String(value ?? "").trim().toLowerCase() === "development" ? "development" : "production";

const getDb = (firestoreDb?: string) => getFirestore(getFirebaseApp(), normalizeFirestoreDb(firestoreDb || config.pitixFirestoreDb));

const normalizeCart = (value: SavedVoiceCartDocument): SavedVoiceCartDocument => ({
  ...value,
  notes: value.notes ?? null,
  store_name: value.store_name ?? null,
  user_name: value.user_name ?? null,
  sale_channel: value.sale_channel ?? null,
  customer: value.customer ?? null,
  createdAt: String(value.createdAt || new Date().toISOString()),
  updatedAt: String(value.updatedAt || new Date().toISOString()),
});

const buildCollectionPath = (businessId: string, storeId: string): string =>
  `/save_carts/${businessId}/stores/${storeId}/carts`;

const buildLegacyCollectionPath = (businessId: string, storeId: string): string =>
  `save_carts/${businessId}/stores/${storeId}/carts`;

export const savedCartFirestoreService = {
  buildCollectionPath,

  async list(params: { businessId: string; storeId: string; firestoreDb?: string }): Promise<SavedVoiceCartDocument[]> {
    const firestoreDb = normalizeFirestoreDb(params.firestoreDb);
    const collectionPaths = Array.from(
      new Set([
        buildCollectionPath(params.businessId, params.storeId),
        buildLegacyCollectionPath(params.businessId, params.storeId),
      ]),
    );

    const snapshots = await Promise.all(
      collectionPaths.map((collectionPath) =>
        getDb(firestoreDb).collection(collectionPath).orderBy("updatedAt", "desc").limit(100).get(),
      ),
    );

    const merged = new Map<string, SavedVoiceCartDocument>();
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const cart = { ...doc.data(), id: doc.id } as SavedVoiceCartDocument;
        if (!cart || typeof cart !== "object" || !String(cart.id || "").trim()) {
          continue;
        }
        const normalized = normalizeCart(cart);
        const existing = merged.get(normalized.id);
        if (!existing) {
          merged.set(normalized.id, normalized);
          continue;
        }

        if (new Date(normalized.updatedAt).valueOf() >= new Date(existing.updatedAt).valueOf()) {
          merged.set(normalized.id, normalized);
        }
      }
    }

    return Array.from(merged.values()).sort(
      (left, right) => new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf(),
    );
  },

  async createOrUpdate(params: {
    businessId: string;
    storeId: string;
    cart: SavedVoiceCartDocument;
    firestoreDb?: string;
  }): Promise<SavedVoiceCartDocument> {
    const collectionPath = buildCollectionPath(params.businessId, params.storeId);
    const normalizedCart = normalizeCart(params.cart);
    const docRef = getDb(params.firestoreDb).collection(collectionPath).doc(normalizedCart.id);

    await docRef.set(normalizedCart, { merge: true });
    return normalizedCart;
  },
};
