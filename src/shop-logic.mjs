import { parseReport, scan } from './engine.mjs';
import { readIntakeFile } from './intake.mjs';
import {
  bureauLetter,
  cfpbSheet,
  explainBureau,
  explainCfpb,
  explainFurnisher,
  explainMov,
  explainPacket,
  furnisherLetter,
  movLetter,
} from './letters.mjs';
import { ocrBlob, ocrCanvas } from './ocr.mjs';

const api = {
  scan,
  parseReport,
  readIntakeFile,
  bureauLetter,
  furnisherLetter,
  movLetter,
  cfpbSheet,
  explainBureau,
  explainFurnisher,
  explainMov,
  explainCfpb,
  explainPacket,
  ocrBlob,
  ocrCanvas,
};

globalThis.PeteShop = api;

export default api;
