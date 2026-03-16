import { Router } from "express";
import multer from "multer";
import {
  handleCatalog,
  handleCreate,
  handleParse,
  handleProcess,
  handleRecognize,
  handleSavedCartCreate,
  handleSavedCartList,
  handleSavedCartUpdate,
} from "../handlers/voiceSaleHandlers.js";
import type { RequestWithContext } from "../middleware/requestContext.js";

export const pitixVoiceSaleRouter = Router();
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
  },
});

pitixVoiceSaleRouter.post("/voice-sale/recognize", audioUpload.single("audio"), (req, res, next) => {
  void handleRecognize(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/parse", (req, res, next) => {
  void handleParse(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/catalog", (req, res, next) => {
  void handleCatalog(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/carts/list", (req, res, next) => {
  void handleSavedCartList(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/carts/create", (req, res, next) => {
  void handleSavedCartCreate(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/carts/update", (req, res, next) => {
  void handleSavedCartUpdate(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/process", audioUpload.single("audio"), (req, res, next) => {
  void handleProcess(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/create", (req, res, next) => {
  void handleCreate(req as RequestWithContext, res).catch(next);
});
