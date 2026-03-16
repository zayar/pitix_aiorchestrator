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

const getDb = () => getFirestore(getFirebaseApp(), config.pitixFirestoreDb);

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
  `save_carts/${businessId}/stores/${storeId}/carts`;

export const savedCartFirestoreService = {
  buildCollectionPath,

  async list(params: { businessId: string; storeId: string }): Promise<SavedVoiceCartDocument[]> {
    const snapshot = await getDb()
      .collection(buildCollectionPath(params.businessId, params.storeId))
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();

    return snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }) as SavedVoiceCartDocument)
      .filter((cart) => cart && typeof cart === "object" && String(cart.id || "").trim())
      .map((cart) => normalizeCart(cart));
  },

  async createOrUpdate(params: {
    businessId: string;
    storeId: string;
    cart: SavedVoiceCartDocument;
  }): Promise<SavedVoiceCartDocument> {
    const collectionPath = buildCollectionPath(params.businessId, params.storeId);
    const normalizedCart = normalizeCart(params.cart);
    const docRef = getDb().collection(collectionPath).doc(normalizedCart.id);

    await docRef.set(normalizedCart, { merge: true });
    return normalizedCart;
  },
};
