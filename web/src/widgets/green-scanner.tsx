import "@/index.css";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { mountWidget } from "skybridge/web";

type FindSustainableArgs = {
  product_query: string;
  image_base64?: string | null;
};

type ToolContent = {
  type: string;
  text?: string;
};

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
  alternatives: ProductDetails[];
};

type ToolResult = {
  content?: ToolContent[];
  structuredContent?: SustainableResult;
  [key: string]: unknown;
};

function GreenScannerWidget() {
  const [query, setQuery] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [lastImageDataUrl, setLastImageDataUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "ready">("idle");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleAlternatives, setVisibleAlternatives] = useState(3);

  const isPending = status === "pending";
  const isError = status === "error";
  const isImageMode = imageReady;

  const callTool = async (args: FindSustainableArgs) => {
    setStatus("pending");
    setError(null);
    setResult(null);
    if (args.image_base64) {
      setLastImageDataUrl(args.image_base64);
    }
    try {
      let data: ToolResult;
      const openai = (window as unknown as { openai?: Record<string, unknown> }).openai;
      if (openai && typeof openai.callTool === "function") {
        data = (await openai.callTool("find_sustainable_alternative", args)) as ToolResult;
      } else {
        const response = await fetch("/api/find", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...args,
            image_base64: args.image_base64 ?? imageDataUrl ?? undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as SustainableResult;
        data = {
          content: [{ type: "text", text: payload.text ?? "" }],
          structuredContent: payload,
        };
      }
      setResult(data);
      setStatus("success");
      setVisibleAlternatives(3);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const responseText = useMemo(() => {
    if (!result?.content) return "";
    return result.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }, [result]);

  const structured = result?.structuredContent;
  const product = structured?.product;
  const alternatives = structured?.alternatives ?? [];
  const showAlternatives = alternatives.slice(0, visibleAlternatives);
  const hasMoreAlternatives = alternatives.length > visibleAlternatives;
  const isGoodChoice =
    product?.ecoscore.toUpperCase() === "A" || product?.nutriscore.toUpperCase() === "A";
  const placeholderImage =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#d7f0e3"/>
            <stop offset="100%" stop-color="#f7ecd2"/>
          </linearGradient>
        </defs>
        <rect width="180" height="180" rx="28" fill="url(#g)"/>
        <circle cx="90" cy="80" r="42" fill="#1f7a50" opacity="0.14"/>
        <path d="M90 54c10 0 18 8 18 18 0 14-18 34-18 34S72 86 72 72c0-10 8-18 18-18z" fill="#1f7a50"/>
        <rect x="48" y="118" width="84" height="8" rx="4" fill="#1f7a50" opacity="0.2"/>
        <text x="90" y="150" text-anchor="middle" font-family="Space Grotesk, sans-serif" font-size="12" fill="#1f7a50">Eco Pick</text>
      </svg>`,
    );
  const buildImageSrc = (url?: string | null) => {
    if (!url) return "";
    if (url.startsWith("data:image")) return url;
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  };
  const isValidImageUrl = (value?: string | null) =>
    typeof value === "string" &&
    (value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:image"));
  const fallbackImage =
    lastImageDataUrl || imageDataUrl || (isImageMode ? placeholderImage : "");
  const productImage = isImageMode
    ? fallbackImage || placeholderImage
    : (isValidImageUrl(product?.imageUrl) ? buildImageSrc(product?.imageUrl) : "") ||
      placeholderImage;

  useEffect(() => {
    if (!isImageMode) return;
    if (!product?.name) return;
    if (query.trim()) return;
    setQuery(product.name);
  }, [isImageMode, product?.name, query]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isImageMode) {
      void callTool({
        product_query: "",
        image_base64: imageDataUrl ?? undefined,
      });
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    void callTool({
      product_query: trimmed,
      image_base64: imageDataUrl ?? undefined,
    });
  };

  const handleFile = async (file: File) => {
    setUploadStatus("uploading");
    setImageReady(false);
    setImageDataUrl(null);
    const compressImage = (inputFile: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const maxSize = 768;
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            const width = Math.round(img.width * scale);
            const height = Math.round(img.height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas not supported"));
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
            resolve(dataUrl);
          };
          img.onerror = () => reject(new Error("Image load failed"));
          if (typeof reader.result === "string") {
            img.src = reader.result;
          } else {
            reject(new Error("Image read failed"));
          }
        };
        reader.onerror = () => reject(new Error("Image read failed"));
        reader.readAsDataURL(inputFile);
      });
    try {
      const dataUrl = await compressImage(file);
      setImageDataUrl(dataUrl);
      setLastImageDataUrl(dataUrl);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    const openai = (window as unknown as { openai?: Record<string, unknown> }).openai;
    if (openai?.uploadFile) {
      const uploaded = await (openai.uploadFile as (file: File) => Promise<{ id: string }>)(file);
      void uploaded;
    }
    setUploadStatus("ready");
    setImageReady(true);
  };

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <div>
            <h1 className="title">
              <strong>EcoTrace</strong>:{" "}
              <em>Your Environment-friendly AI Nutritionist</em>
            </h1>
            <p className="subtitle">
              Enter a product name or upload a picture and instantly compare its Eco and
              Nutri-Score (estimated by web and compiled by AI) against potentially better
              sustainable alternatives.
            </p>
          </div>
        </header>

        <section className="card">
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit(event);
            }}
          >
            <label className="label" htmlFor="product-query">
              Product from your photo
            </label>
            <div
              className={`input-row ${uploadStatus === "uploading" ? "is-uploading" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) {
                  void handleFile(file);
                }
              }}
            >
              <input
                id="product-query"
                name="product-query"
                type="text"
                placeholder="e.g., Barilla Spaghetti"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={isImageMode}
              />
              <label htmlFor="product-image" className="upload-inline">
                {uploadStatus === "uploading" ? "Uploading..." : "Search by Image"}
              </label>
              <input
                id="product-image"
                type="file"
                accept="image/*"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void handleFile(file);
                }}
              />
              <button type="submit" disabled={isPending || (!query.trim() && !imageReady)}>
                {isPending ? "Scanning..." : "Analyse/Alternatives"}
              </button>
              <button
                type="button"
                className="refresh-button"
                disabled={!structured}
                onClick={() => window.location.reload()}
              >
                Refresh
              </button>
            </div>
            <p className="helper">
              Tip: include the brand name for more accurate matches.
            </p>
            {imageReady && (
              <div className="image-preview-row">
                {imageDataUrl && (
                  <img
                    className="image-preview"
                    src={imageDataUrl}
                    alt="Uploaded product preview"
                  />
                )}
                <span className="helper">
                  {product?.name
                    ? `Identified: ${product.name}`
                    : "Image ready. We will identify it during analysis."}
                </span>
              </div>
            )}
          </form>

          {isPending && (
            <div className="status" aria-live="polite">
              <span className="pulse" />
              Searching...
            </div>
          )}

          {isError && (
            <div className="result" role="alert">
              Something went wrong: {error}
            </div>
          )}

          {structured && product && !isPending ? (
            <div className="result-grid" aria-live="polite">
              <div className="product-card">
                <img
                  className="product-image"
                  src={productImage}
                  alt="Default product"
                  onError={(event) => {
                    event.currentTarget.src = placeholderImage;
                  }}
                />
                <div className="product-info">
                  <div className="product-title">{product.name}</div>
                  <div className="product-brand">{product.brand}</div>
                  <div className="badge-row">
                    <span className="eco-badge">Eco-Score {product.ecoscore}</span>
                    <span className={`nutri-badge nutri-${product.nutriscore.toLowerCase()}`}>
                      Nutri-Score {product.nutriscore}
                    </span>
                  </div>
                  {product.ecoEstimated ||
                  product.nutriEstimated ||
                  product.detailsEstimated ? (
                    <div className="estimate-note">Estimated with ChatGPT + web sources</div>
                  ) : (
                    <div className="estimate-note">
                      Obtained from Open Food Facts Database
                    </div>
                  )}
                  <div className="analysis-note">
                    {isGoodChoice
                      ? "your product is already a good choice!"
                      : "Yum, but you have better options ;)"}
                  </div>
                  <div className="detail-list">
                    <div>
                      <span>Categories</span>
                      <strong>{product.categories}</strong>
                    </div>
                    <div>
                      <span>Packaging</span>
                      <strong>{product.packaging}</strong>
                    </div>
                    <div>
                      <span>Labels</span>
                      <strong>{product.labels}</strong>
                    </div>
                    <div>
                      <span>Ingredients</span>
                      <strong>{product.ingredients}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {alternatives.length > 0 && (
                <div className="alternatives">
                  <div className="section-title">
                    {isGoodChoice ? "Some other choices..." : "You may want to consider..."}
                  </div>
                  <div className="alternative-list">
                    {showAlternatives.map((alt, index) => (
                      <div className="alternative-card" key={`${alt.name}-${index}`}>
                        <div className="alternative-header">
                          <div className="alternative-main">
                            <img
                              className="alternative-image"
                              src={alt.imageUrl || placeholderImage}
                              alt={alt.name}
                            />
                            <div>
                              <div className="alternative-name">{alt.name}</div>
                              <div className="alternative-brand">{alt.brand}</div>
                            </div>
                          </div>
                          <div className="badge-row alt-badges">
                            <span className="eco-badge">Eco-Score {alt.ecoscore}</span>
                            <span className={`nutri-badge nutri-${alt.nutriscore.toLowerCase()}`}>
                              Nutri-Score {alt.nutriscore}
                            </span>
                          </div>
                        </div>
                        <div className="detail-list">
                          <div>
                            <span>Categories</span>
                            <strong>{alt.categories}</strong>
                          </div>
                          <div>
                            <span>Packaging</span>
                            <strong>{alt.packaging}</strong>
                          </div>
                          <div>
                            <span>Labels</span>
                            <strong>{alt.labels}</strong>
                          </div>
                          <div>
                            <span>Ingredients</span>
                            <strong>{alt.ingredients}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {hasMoreAlternatives && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setVisibleAlternatives((count) => count + 3)}
                    >
                      View more
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {!structured && responseText && !isPending && (
            <div className="result" aria-live="polite">
              {responseText}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default GreenScannerWidget;

mountWidget(<GreenScannerWidget />);
