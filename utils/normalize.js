export const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const normalizePhone = (value) => {
  const text = normalizeText(value);
  if (!text) return "";
  const digits = text.replace(/[^\d]/g, "");
  if (digits.startsWith("84") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }
  return digits;
};

export const parseReviewCount = (value) => {
  const text = normalizeText(value);
  const match = text.match(/[\d.,]+/);
  if (!match) return "";
  return match[0].replace(/[.,]/g, "");
};

export const parseRating = (value) => {
  const text = normalizeText(value).replace(",", ".");
  const match = text.match(/\d+(\.\d+)?/);
  return match ? match[0] : "";
};
