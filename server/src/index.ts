import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { z } from "zod";

import { mcp } from "./middleware.js";

// Create the Skybridge MCP Server (Green Scanner)
const server = new McpServer({
  name: "green-scanner",
  version: "1.0.0",
});

const widgetName = "green-scanner";
const widgetUri = `ui://widgets/apps-sdk/${widgetName}.html`;
const widgetEntryKey = `src/widgets/${widgetName}.tsx`;

const renderWidgetHtml = (serverUrl: string, widgetFile: string, styleFile: string) => {
  return `<script type="module">window.skybridge = { hostType: "apps-sdk", serverUrl: "${serverUrl}" };</script>
<div id="root"></div>
<script type="module">
  import("${serverUrl}/assets/${widgetFile}");
</script>
<link rel="stylesheet" crossorigin href="${serverUrl}/assets/${styleFile}" />`;
};

const resolveWidgetFiles = () => {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const manifestPath = path.resolve(__dirname, "assets", ".vite", "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as Record<string, { file: string; isEntry?: boolean }>;
    const widgetEntry =
      manifest[widgetEntryKey] ??
      Object.values(manifest).find((entry) => entry.isEntry === true);
    const styleEntry = manifest["style.css"];
    const widgetFile = widgetEntry?.file?.replace(/^assets\//, "");
    const styleFile = styleEntry?.file?.replace(/^assets\//, "");
    if (!widgetFile || !styleFile) return null;
    return { widgetFile, styleFile };
  } catch {
    return null;
  }
};

server.registerResource(
  widgetName,
  widgetUri,
  {
    description: "EcoTrace widget UI",
    mimeType: "text/html+skybridge",
  },
  async (_uri, extra) => {
    const headers = extra?.requestInfo?.headers ?? {};
    const host = headers["x-forwarded-host"] ?? headers.host ?? "";
    const serverUrl = host ? `https://${host}` : "http://localhost:3000";
    const files = resolveWidgetFiles();
    const html = files
      ? renderWidgetHtml(serverUrl, files.widgetFile, files.styleFile)
      : `<div>Widget assets not found.</div>`;
    return {
      contents: [
        {
          uri: widgetUri,
          mimeType: "text/html+skybridge",
          text: html,
        },
      ],
    };
  },
);

type ProductDetails = {
  name: string;
  brand: string;
  categories: string;
  packaging: string;
  labels: string;
  ingredients: string;
  ecoscore: string;
  nutriscore: string;
  imageUrl: string;
  ecoEstimated?: boolean;
  nutriEstimated?: boolean;
  detailsEstimated?: boolean;
};

type SustainableResult = {
  text: string;
  product: ProductDetails;
  alternatives: Array<ProductDetails>;
};

type EstimationResult = {
  name?: string;
  brand?: string;
  categories?: string;
  packaging?: string;
  labels?: string;
  ingredients?: string;
  ecoscore?: string;
  nutriscore?: string;
  imageUrl?: string;
};

export async function buildSustainableAlternativeResult(
  product_query: string,
  imageBase64?: string,
): Promise<SustainableResult> {
  const formatTags = (tags: unknown, fallback = "Unknown") => {
    if (!Array.isArray(tags)) return fallback;
    const cleaned = tags
      .map((tag) => String(tag).replace(/^en:/, "").replace(/-/g, " ").trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(", ") : fallback;
  };

  const scoreRank = (score: string) => {
    const normalized = score.toUpperCase();
    const rankMap: Record<string, number> = {
      A: 1,
      B: 2,
      C: 3,
      D: 4,
      E: 5,
    };
    return rankMap[normalized] ?? 6;
  };

  const isScoreGood = (score: string) => score.toUpperCase() === "A";

  const goodChoiceMessage = (eco: string, nutri: string) => {
    if (isScoreGood(eco) || isScoreGood(nutri)) {
      return {
        analysis: "your product is already a good choice!",
        alternativesTitle: "Some other choices...",
      };
    }
    return {
      analysis: "Yum, but you have better options ;)",
      alternativesTitle: "You may want to consider...",
    };
  };

  const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try {
      return await promise;
    } finally {
      clearTimeout(timeout);
    }
  };

  const fetchBraveResults = async (query: string) => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) return [];
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
      query,
    )}&count=3`;
    const res = await withTimeout(
      fetch(url, {
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
          "Accept-Encoding": "gzip",
        },
      }),
      4000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data?.web?.results) ? data.web.results : [];
    return results.slice(0, 3).map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.description || "",
    }));
  };


  const normalizeField = (value: string | undefined, fallback = "Estimated") => {
    const trimmed = (value || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "unknown") return fallback;
    return trimmed;
  };

  const normalizeScore = (value: string | undefined) => {
    const trimmed = (value || "").trim().toUpperCase();
    if (["A", "B", "C", "D", "E"].includes(trimmed)) return trimmed;
    return "C";
  };

  const parseStructuredOutput = <T>(data: unknown): T | null => {
    const candidates: string[] = [];
    const outputText =
      typeof (data as { output_text?: unknown })?.output_text === "string"
        ? ((data as { output_text?: string }).output_text ?? "")
        : "";
    if (outputText) candidates.push(outputText);
    const content = Array.isArray((data as { output?: unknown[] })?.output)
      ? ((data as { output?: Array<{ content?: unknown[] }> }).output ?? [])[0]?.content
      : undefined;
    if (Array.isArray(content)) {
      for (const item of content) {
        const text = (item as { text?: unknown })?.text;
        if (typeof text === "string" && text) candidates.push(text);
        const json = (item as { json?: unknown })?.json;
        if (json && typeof json === "object") return json as T;
      }
    }
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // ignore
      }
    }
    return null;
  };

  const estimateWithOpenAI = async (
    name: string,
    webResults: Array<{ title: string; url: string; snippet: string }>,
    imageData?: string,
  ): Promise<EstimationResult | null> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const system = `You are a product sustainability assistant. Estimate missing product fields and Eco/Nutri scores (A-E).
Never return "Unknown". If uncertain, provide a best-guess string and set ecoscore/nutriscore to "C".
Return JSON ONLY with keys: name, brand, categories, packaging, labels, ingredients, ecoscore, nutriscore, imageUrl.`;
    const webText =
      webResults.length > 0
        ? webResults
            .map((r, i) => `Result ${i + 1}: ${r.title}\n${r.snippet}\n${r.url}`)
            .join("\n\n")
        : "No web results available.";
    const userText = `Product query: ${name}\n\nWeb results:\n${webText}`;
    const input: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          ...(imageData
            ? [
                {
                  type: "input_image",
                  image_url: imageData,
                },
              ]
            : []),
        ],
      },
    ];
    const res = await withTimeout(
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
        model: "gpt-4.1",
          input,
          text: {
            format: {
              type: "json_schema",
              name: "product_estimate",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  brand: { type: "string" },
                  categories: { type: "string" },
                  packaging: { type: "string" },
                  labels: { type: "string" },
                  ingredients: { type: "string" },
                  ecoscore: { type: "string" },
                  nutriscore: { type: "string" },
                  imageUrl: { type: "string" },
                },
                required: ["name", "brand", "categories", "packaging", "labels", "ingredients", "ecoscore", "nutriscore", "imageUrl"],
              },
            },
          },
        }),
      }),
      6000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseStructuredOutput<EstimationResult>(data);
  };

  const identifyProductFromImage = async (
    imageData: string,
  ): Promise<{ name: string; brand: string } | null> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const system =
      "Identify the packaged grocery product in the image. Return JSON ONLY with keys: name, brand. " +
      "Use a specific product name (e.g., 'Lay's Classic Potato Chips'). If unsure, provide a best-guess and never return 'Unknown'.";
    const input: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Identify the product in this image." },
          { type: "input_image", image_url: imageData },
        ],
      },
    ];
    const res = await withTimeout(
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          input,
          text: {
            format: {
              type: "json_schema",
              name: "image_product_identification",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  brand: { type: "string" },
                },
                required: ["name", "brand"],
              },
            },
          },
        }),
      }),
      6000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseStructuredOutput<{ name: string; brand: string }>(data);
  };


  const trimmedQuery = (product_query || "").trim();
  let effectiveQuery = trimmedQuery;
  let imageDerivedName: string | null = null;
  let imageDerivedBrand: string | null = null;

  if (!effectiveQuery && imageBase64) {
    const imageIdentification = await identifyProductFromImage(imageBase64);
    const normalizedName = normalizeField(imageIdentification?.name, "Unknown");
    const normalizedBrand = normalizeField(imageIdentification?.brand, "");
    if (normalizedName !== "Unknown") {
      const combined = [normalizedBrand, normalizedName].filter(Boolean).join(" ").trim();
      effectiveQuery = combined || normalizedName;
      imageDerivedName = normalizedName;
      imageDerivedBrand = normalizedBrand || null;
    }
  }

  if (!effectiveQuery) {
    const estimate = await estimateWithOpenAI("Unknown product", [], imageBase64);
    return {
      text: "No product name detected from the image. Showing estimated details.",
      product: {
        name: normalizeField(estimate?.name, "Unknown"),
        brand: normalizeField(estimate?.brand),
        categories: normalizeField(estimate?.categories),
        packaging: normalizeField(estimate?.packaging),
        labels: normalizeField(estimate?.labels),
        ingredients: normalizeField(estimate?.ingredients),
        ecoscore: normalizeScore(estimate?.ecoscore),
        nutriscore: normalizeScore(estimate?.nutriscore),
        imageUrl: estimate?.imageUrl || "",
        ecoEstimated: true,
        nutriEstimated: true,
        detailsEstimated: true,
      },
      alternatives: [],
    };
  }

  const pickAlternatives = (
    altProducts: Array<Record<string, unknown>>,
    ecoScore: string,
    nutri: string,
    originalName: string,
  ) => {
    const ecoRank = scoreRank(ecoScore);
    const nutriRank = scoreRank(nutri);
    const scored = altProducts
      .filter((p) => typeof p.product_name === "string")
      .map((p) => {
        const name = String(p.product_name || "").trim();
        const brand = p.brands ? String(p.brands).split(",")[0].trim() : "Unknown";
        const scoreRaw =
          typeof p.ecoscore_grade === "string"
            ? p.ecoscore_grade.toUpperCase()
            : "?";
        const nutriRaw =
          typeof p.nutriscore_grade === "string"
            ? p.nutriscore_grade.toUpperCase()
            : "Unknown";
        return {
          name,
          brand,
          score: scoreRaw,
          categories: formatTags(p.categories_tags),
          packaging: formatTags(p.packaging_tags),
          labels: formatTags(p.labels_tags),
          ingredients:
            typeof p.ingredients_text === "string" && p.ingredients_text.trim()
              ? p.ingredients_text.trim()
              : "Unknown",
          nutriScore: nutriRaw,
          imageUrl:
            (typeof p.image_front_url === "string" && p.image_front_url) ||
            (typeof p.image_url === "string" && p.image_url) ||
            "",
        };
      })
      .filter((p) => p.name && p.name.toLowerCase() !== originalName.toLowerCase())
      .filter(
        (p) =>
          scoreRank(p.score) <= ecoRank && scoreRank(p.nutriScore) <= nutriRank,
      );

    const buckets: Record<string, ProductDetails[]> = {
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      "?": [],
    };

    for (const item of scored) {
      const bucketKey = buckets[item.score] ? item.score : "?";
      buckets[bucketKey].push({
        name: item.name,
        brand: item.brand,
        categories: item.categories,
        packaging: item.packaging,
        labels: item.labels,
        ingredients: item.ingredients,
        ecoscore: item.score,
        nutriscore: item.nutriScore,
        imageUrl: item.imageUrl,
      });
    }

    const ordered = [
      ...buckets.A,
      ...buckets.B,
      ...buckets.C,
      ...buckets.D,
      ...buckets.E,
      ...buckets["?"],
    ];
    return ordered.slice(0, 6);
  };

  const isUnknownScore = (value: string) => {
    const normalized = (value || "").trim().toUpperCase();
    return !normalized || normalized === "?" || normalized === "UNKNOWN";
  };

  const isValidImageUrl = (value?: string) =>
    typeof value === "string" &&
    (value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:image"));

  const pickImageFromOffProducts = (
    products: Array<Record<string, unknown>>,
    query: string,
    brand?: string,
  ) => {
    const normalizeText = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const normalizedQuery = normalizeText(query);
    const queryTokens = normalizedQuery.split(" ").filter(Boolean);
    const brandTokens = brand ? normalizeText(brand).split(" ").filter(Boolean) : [];

    const scoreProduct = (p: Record<string, unknown>) => {
      const name = typeof p.product_name === "string" ? normalizeText(p.product_name) : "";
      const brands = typeof p.brands === "string" ? normalizeText(p.brands) : "";
      let score = 0;
      if (name && name === normalizedQuery) score += 6;
      if (name && normalizedQuery && name.includes(normalizedQuery)) score += 4;
      if (normalizedQuery && name && normalizedQuery.includes(name)) score += 3;
      for (const token of queryTokens) {
        if (token && name.includes(token)) score += 1;
      }
      for (const token of brandTokens) {
        if (token && brands.includes(token)) score += 2;
      }
      return score;
    };

    const withImage = products.filter(
      (p) =>
        typeof p.image_front_url === "string" || typeof p.image_url === "string",
    );
    if (withImage.length === 0) return "";
    const best = withImage.sort((a, b) => scoreProduct(b) - scoreProduct(a))[0];
    return (
      (typeof best?.image_front_url === "string" && best.image_front_url) ||
      (typeof best?.image_url === "string" && best.image_url) ||
      ""
    );
  };

  const isMissingDetails = (details: ProductDetails) =>
    details.brand === "Unknown" ||
    details.categories === "Unknown" ||
    details.packaging === "Unknown" ||
    details.labels === "Unknown" ||
    details.ingredients === "Unknown" ||
    isUnknownScore(details.ecoscore) ||
    isUnknownScore(details.nutriscore);

  // Step A: Find the Original Product
  const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
    effectiveQuery,
  )}&search_simple=1&action=process&json=1`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    let estimate = await estimateWithOpenAI(effectiveQuery, [], imageBase64);
    if (
      !estimate ||
      Object.values(estimate).every((value) => !value || value === "Unknown")
    ) {
      const webResults = await fetchBraveResults(effectiveQuery);
      estimate = await estimateWithOpenAI(effectiveQuery, webResults, imageBase64);
    }
    return {
      text: `Error: Could not reach Open Food Facts (${searchRes.status}). Using estimated data.`,
      product: {
        name: normalizeField(estimate?.name, effectiveQuery),
        brand: normalizeField(estimate?.brand),
        categories: normalizeField(estimate?.categories),
        packaging: normalizeField(estimate?.packaging),
        labels: normalizeField(estimate?.labels),
        ingredients: normalizeField(estimate?.ingredients),
        ecoscore: normalizeScore(estimate?.ecoscore),
        nutriscore: normalizeScore(estimate?.nutriscore),
        imageUrl: estimate?.imageUrl || "",
        ecoEstimated: true,
        nutriEstimated: true,
        detailsEstimated: true,
      },
      alternatives: [],
    };
  }

  const searchData = await searchRes.json();
  if (!searchData.products || searchData.products.length === 0) {
    const fallbackUrl = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(
      effectiveQuery,
    )}&sort_by=popularity&page_size=24&fields=product_name,brands,ecoscore_grade,categories_tags,packaging_tags,labels_tags,nutriscore_grade,ingredients_text,image_url,image_front_url`;
    const fallbackRes = await fetch(fallbackUrl);
    const fallbackData = fallbackRes.ok ? await fallbackRes.json() : { products: [] };
    const fallbackProducts = Array.isArray(fallbackData.products)
      ? fallbackData.products
      : [];
    let estimate = await estimateWithOpenAI(effectiveQuery, [], imageBase64);
    if (
      !estimate ||
      Object.values(estimate).every((value) => !value || value === "Unknown")
    ) {
      const webResults = await fetchBraveResults(effectiveQuery);
      estimate = await estimateWithOpenAI(effectiveQuery, webResults, imageBase64);
    }
    const alternatives = pickAlternatives(fallbackProducts, "?", "Unknown", effectiveQuery);
    return {
      text: `No exact match found for "${effectiveQuery}". Showing the best available similar products and estimated details.`,
      product: {
        name: normalizeField(estimate?.name, effectiveQuery),
        brand: normalizeField(estimate?.brand),
        categories: normalizeField(estimate?.categories),
        packaging: normalizeField(estimate?.packaging),
        labels: normalizeField(estimate?.labels),
        ingredients: normalizeField(estimate?.ingredients),
        ecoscore: normalizeScore(estimate?.ecoscore),
        nutriscore: normalizeScore(estimate?.nutriscore),
        imageUrl: estimate?.imageUrl || "",
        ecoEstimated: true,
        nutriEstimated: true,
        detailsEstimated: true,
      },
      alternatives,
    };
  }

  const product = searchData.products[0];
  const productName = product.product_name || effectiveQuery;
  const ecoscoreGradeRaw = product.ecoscore_grade || "?";
  const ecoscoreGrade = String(ecoscoreGradeRaw).toLowerCase();
  const ecoscoreDisplay = ecoscoreGrade === "?" ? "?" : ecoscoreGrade.toUpperCase();
  const nutriScore =
    typeof product.nutriscore_grade === "string"
      ? product.nutriscore_grade.toUpperCase()
      : "Unknown";
  const categoriesTags: string[] = Array.isArray(product.categories_tags)
    ? product.categories_tags
    : [];
  const brand = product.brands ? String(product.brands).split(",")[0].trim() : "Unknown";
  const packaging = formatTags(product.packaging_tags);
  const labels = formatTags(product.labels_tags);
  const imageUrl =
    (typeof product.image_front_url === "string" && product.image_front_url) ||
    (typeof product.image_url === "string" && product.image_url) ||
    "";
  const ingredients =
    typeof product.ingredients_text === "string" && product.ingredients_text.trim()
      ? product.ingredients_text.trim()
      : "Unknown";

  const productDetails: ProductDetails = {
    name: productName,
    brand,
    categories: formatTags(categoriesTags),
    packaging,
    labels,
    ingredients,
    ecoscore: ecoscoreDisplay,
    nutriscore: nutriScore,
    imageUrl,
    ecoEstimated: false,
    nutriEstimated: false,
    detailsEstimated: false,
  };
  if (imageDerivedName) {
    productDetails.name = imageDerivedName;
  }
  if (imageDerivedBrand && productDetails.brand === "Unknown") {
    productDetails.brand = imageDerivedBrand;
  }
  const needsEstimation = isMissingDetails(productDetails);
  if (needsEstimation) {
    let estimate = await estimateWithOpenAI(productName, [], imageBase64);
    if (!estimate || Object.values(estimate).every((value) => !value || value === "Unknown")) {
      const webResults = await fetchBraveResults(productName);
      estimate = await estimateWithOpenAI(productName, webResults, imageBase64);
    }
    if (estimate) {
      productDetails.name = normalizeField(estimate.name, productDetails.name);
      productDetails.brand = normalizeField(estimate.brand, productDetails.brand);
      productDetails.categories = normalizeField(estimate.categories, productDetails.categories);
      productDetails.packaging = normalizeField(estimate.packaging, productDetails.packaging);
      productDetails.labels = normalizeField(estimate.labels, productDetails.labels);
      productDetails.ingredients = normalizeField(
        estimate.ingredients,
        productDetails.ingredients,
      );
      if (isUnknownScore(productDetails.ecoscore)) {
        productDetails.ecoscore = normalizeScore(estimate.ecoscore);
        productDetails.ecoEstimated = true;
      }
      if (isUnknownScore(productDetails.nutriscore)) {
        productDetails.nutriscore = normalizeScore(estimate.nutriscore);
        productDetails.nutriEstimated = true;
      }
      if (!productDetails.ecoEstimated && estimate.ecoscore) {
        productDetails.ecoscore = normalizeScore(estimate.ecoscore);
        productDetails.ecoEstimated = true;
      }
      if (!productDetails.nutriEstimated && estimate.nutriscore) {
        productDetails.nutriscore = normalizeScore(estimate.nutriscore);
        productDetails.nutriEstimated = true;
      }
      if (
        estimate.brand ||
        estimate.categories ||
        estimate.packaging ||
        estimate.labels ||
        estimate.ingredients
      ) {
        productDetails.detailsEstimated = true;
      }
      if (estimate.imageUrl && isValidImageUrl(estimate.imageUrl)) {
        productDetails.imageUrl = estimate.imageUrl;
      }
    }
  }

  let offImageDebug = "";
  const fetchTopOffImage = async (query: string) => {
    const imageSearchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      query,
    )}&search_simple=1&action=process&json=1&page_size=1`;
    const imageSearchRes = await fetch(imageSearchUrl);
    if (!imageSearchRes.ok) return "";
    const imageSearchData = await imageSearchRes.json();
    const imageProducts = Array.isArray(imageSearchData.products)
      ? imageSearchData.products
      : [];
    const first = imageProducts[0] || {};
    return (
      (typeof first.image_front_url === "string" && first.image_front_url) ||
      (typeof first.image_url === "string" && first.image_url) ||
      ""
    );
  };

  const hydrateImageFromOff = async (query: string) => {
    const searchQueries: string[] = [];
    if (productDetails.brand && productDetails.brand !== "Unknown") {
      searchQueries.push(`${productDetails.brand} ${query}`);
    }
    searchQueries.push(query);
    if (effectiveQuery && !searchQueries.includes(effectiveQuery)) {
      searchQueries.push(effectiveQuery);
    }

    for (const q of searchQueries) {
      const imageSearchUrl = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(
        q,
      )}&page_size=12&fields=product_name,brands,image_url,image_front_url`;
      const imageSearchRes = await fetch(imageSearchUrl);
      if (imageSearchRes.ok) {
        const imageSearchData = await imageSearchRes.json();
        const imageProducts = Array.isArray(imageSearchData.products)
          ? imageSearchData.products
          : [];
        const imageUrl = pickImageFromOffProducts(
          imageProducts,
          q,
          productDetails.brand,
        );
        if (!offImageDebug) {
          offImageDebug = imageUrl || "(none)";
        }
        if (isValidImageUrl(imageUrl)) {
          productDetails.imageUrl = imageUrl;
          return true;
        }
      }
    }
    return false;
  };

  let offTopImageDebug = "";
  let offQueryDebug = "";
  if (!imageBase64) {
    const query = productDetails.name || effectiveQuery;
    offQueryDebug = query;
    const topImage = await fetchTopOffImage(query);
    offTopImageDebug = topImage || "(none)";
    if (isValidImageUrl(topImage)) {
      productDetails.imageUrl = topImage;
    }
  }

  const hydrateTopImageFromOff = async (query: string) => {
    const imageSearchUrl = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(
      query,
    )}&page_size=1&fields=product_name,brands,image_url,image_front_url`;
    const imageSearchRes = await fetch(imageSearchUrl);
    if (!imageSearchRes.ok) return false;
    const imageSearchData = await imageSearchRes.json();
    const imageProducts = Array.isArray(imageSearchData.products)
      ? imageSearchData.products
      : [];
    const first = imageProducts[0] || {};
    const imageUrl =
      (typeof first.image_front_url === "string" && first.image_front_url) ||
      (typeof first.image_url === "string" && first.image_url) ||
      "";
    if (isValidImageUrl(imageUrl)) {
      productDetails.imageUrl = imageUrl;
      return true;
    }
    return false;
  };

  if (!imageBase64) {
    if (
      productDetails.ecoEstimated ||
      productDetails.nutriEstimated ||
      productDetails.detailsEstimated
    ) {
      await hydrateTopImageFromOff(productDetails.name);
    } else if (!isValidImageUrl(productDetails.imageUrl)) {
      await hydrateImageFromOff(productDetails.name);
    }
  }
  const scannedLine = `🔍 Scanned: ${productDetails.name} (Eco-Score: ${productDetails.ecoscore})`;
  const detailBlock = [
    "**Details**",
    `- Brand: ${productDetails.brand}`,
    `- Categories: ${productDetails.categories}`,
    `- Packaging: ${productDetails.packaging}`,
    `- Labels: ${productDetails.labels}`,
    `- Ingredients: ${productDetails.ingredients}`,
    `- Nutri-Score: **${productDetails.nutriscore}**`,
  ].join("\n");
  const productMessages = goodChoiceMessage(
    productDetails.ecoscore,
    productDetails.nutriscore,
  );
  const buildAltUrl = (useCategory: boolean) => {
    const base = "https://world.openfoodfacts.org/api/v2/search";
    const params = new URLSearchParams({
      sort_by: "popularity",
      page_size: "24",
      fields:
        "product_name,brands,ecoscore_grade,categories_tags,packaging_tags,labels_tags,nutriscore_grade,ingredients_text,image_url,image_front_url",
    });
    if (useCategory && categoriesTags.length > 0) {
      params.set("categories_tags", categoriesTags[categoriesTags.length - 1]);
    } else {
      params.set("search_terms", effectiveQuery);
    }
    return `${base}?${params.toString()}`;
  };

  // Step B: Analyze & Search for Alternatives (always attempt)
  const altUrl = buildAltUrl(categoriesTags.length > 0);

  const altRes = await fetch(altUrl);
  if (!altRes.ok) {
    return {
      text: `${scannedLine}\n${detailBlock}\n\nCould not load alternatives right now (Open Food Facts error ${altRes.status}).`,
      product: productDetails,
      alternatives: [],
    };
  }

  const altData = await altRes.json();
  const altProducts = Array.isArray(altData.products) ? altData.products : [];
  let alternatives = pickAlternatives(
    altProducts,
    productDetails.ecoscore,
    productDetails.nutriscore,
    productDetails.name,
  );

  if (alternatives.length < 3) {
    const fallbackRes = await fetch(buildAltUrl(false));
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      const fallbackProducts = Array.isArray(fallbackData.products)
        ? fallbackData.products
        : [];
      const merged = [
        ...alternatives,
        ...pickAlternatives(
          fallbackProducts,
          productDetails.ecoscore,
          productDetails.nutriscore,
          productDetails.name,
        ),
      ];
      const unique = new Map<string, ProductDetails>();
      for (const alt of merged) {
        unique.set(`${alt.brand}-${alt.name}`, alt);
      }
      alternatives = Array.from(unique.values()).slice(0, 6);
    }
  }

  // Skip per-alternative enrichment for performance

  if (alternatives.length === 0) {
    return {
      text: `${scannedLine}\n${detailBlock}\n\n${productMessages.analysis}\n\nNo similar alternatives found. Showing the best available match from Open Food Facts.`,
      product: productDetails,
      alternatives: [],
    };
  }

  const lines = alternatives.map((alt, index) => {
    const detailLines = [
      `   - Brand: ${alt.brand}`,
      `   - Categories: ${alt.categories}`,
      `   - Packaging: ${alt.packaging}`,
      `   - Labels: ${alt.labels}`,
      `   - Ingredients: ${alt.ingredients}`,
      `   - Nutri-Score: **${alt.nutriscore}**`,
    ].join("\n");
    return `${index + 1}. ${alt.brand} ${alt.name} (Score: ${alt.ecoscore})\n${detailLines}`;
  });

  const debugLine = `\n\nOFF query debug: ${offQueryDebug}\nOFF top image debug: ${offTopImageDebug}\nOFF match image debug: ${offImageDebug || "(none)"}`;
  return {
    text: `${scannedLine}\n${detailBlock}\n\n${productMessages.analysis}\n\n${productMessages.alternativesTitle}\n${lines.join("\n")}${debugLine}`,
    product: productDetails,
    alternatives,
  };
}


server.registerTool(
  "find_sustainable_alternative",
  {
    description: "Identifies a product from a search query and finds more sustainable alternatives.",
    inputSchema: {
      product_query: z
        .string()
        .describe("The text identified from the user's photo (e.g., 'Barilla Spaghetti')."),
      image_base64: z
        .string()
        .optional()
        .describe("Optional product image as a data URL for image-based estimation."),
    },
    _meta: {
      "openai/outputTemplate": widgetUri,
    },
  },
  async ({ product_query, image_base64 }) => {
    try {
      const result = await buildSustainableAlternativeResult(product_query, image_base64);
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
      };
    }
  }
);

if (process.env.NODE_ENV === "production") {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(mcp(server));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const assetsDir = path.resolve(__dirname, "assets");
  app.use("/assets", express.static(assetsDir));

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}/`);
    console.log(`MCP:    http://localhost:${PORT}/mcp`);
  });
}

export default server;
