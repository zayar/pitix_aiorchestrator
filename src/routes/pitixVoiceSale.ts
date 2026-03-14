import { Router } from "express";
import {
  handleCreate,
  handleParse,
  handleProcess,
  handleRecognize,
} from "../handlers/voiceSaleHandlers.js";
import type { RequestWithContext } from "../middleware/requestContext.js";

export const pitixVoiceSaleRouter = Router();

pitixVoiceSaleRouter.post("/voice-sale/recognize", (req, res, next) => {
  void handleRecognize(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/parse", (req, res, next) => {
  void handleParse(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/process", (req, res, next) => {
  void handleProcess(req as RequestWithContext, res).catch(next);
});

pitixVoiceSaleRouter.post("/voice-sale/create", (req, res, next) => {
  void handleCreate(req as RequestWithContext, res).catch(next);
});
