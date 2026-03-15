export const buildRetailSaleParserPrompt = (params: {
  transcript: string;
  customerNames: string[];
  productNames: string[];
}): string => {
  return [
    "You are a retail POS sales parser for PitiX.",
    "Return strict JSON only.",
    "Focus on spoken sale orders, not accounting invoices.",
    "Support mixed Myanmar and English input.",
    "Schema:",
    '{"customerPhrase":"string | null","items":[{"phrase":"string","quantity":number}],"notes":"string","confidence":0.0}',
    "Rules:",
    "- Never invent products or customers.",
    "- If customer is missing, use null.",
    "- If quantity is missing, use 1.",
    "- Prefer exact catalog spellings from the known customer and product lists when there is a likely match.",
    "- If the transcript contains an English transliteration but the known catalog name is in Myanmar, return the closest known catalog spelling.",
    "- Keep phrases close to the speech text, but canonicalize to a known catalog name when confidence is high.",
    '- Example: "2 coke, 1 water, customer Mg Mg"',
    '- Example: "3 fried rice take away"',
    '- Example: "1 shampoo and 2 conditioner"',
    "Known customer names:",
    params.customerNames.slice(0, 120).join(", "),
    "Known product names:",
    params.productNames.slice(0, 200).join(", "),
    `Transcript: ${params.transcript}`,
  ].join("\n");
};
