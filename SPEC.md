# Green Scanner — App Spec

ChatGPT app that helps users find more sustainable product alternatives using Open Food Facts Eco-Score.

## Overview

- **Name:** Green Scanner
- **Type:** ChatGPT / MCP app (Skybridge)
- **Purpose:** Given a product query, return the product’s Eco-Score and, if the score is below B, suggest better sustainable alternatives in the same category.
- **UI:** Widget-driven UI for entering a product query and viewing results.
 - **Fallbacks:** If Open Food Facts data is missing, use Brave Search + OpenAI (image-based when available) to estimate fields and scores.

## Tool: `find_sustainable_alternative`

### Input

- **product_query** (string): Product name or search terms (e.g. "Barilla Pasta").
- **image_base64** (optional string): Data URL for a product image (used for image-based estimation).

### Logic

1. **Fetch**  
   `GET https://world.openfoodfacts.org/cgi/search.pl?search_terms=${product_query}&search_simple=1&action=process&json=1`

2. **First product**  
   From the first result, read:
   - `product_name`
   - `ecoscore_grade` (e.g. 'a', 'b', 'c', 'd', 'e')
   - `categories_tags` (array of strings)

3. **Alternatives (always attempt)**  
   - Always search for similar alternatives, up to 6 for “view more”.
   - Prefer category-based search (last `categories_tags` entry). If missing, use `search_terms` with the original query.
   - Only include alternatives whose **Eco-Score OR Nutri-Score is equal or better** than the scanned product.
   - Rank by Eco-Score (A → B → C → D → E → unknown) and take the top results.
   - If no data is available, show the best possible similar products from the fallback search.

4. **Response (text)**  
   - Line 1: `🔍 Scanned: [Product Name] (Eco-Score: [Grade])`
   - Details block with brand, categories, packaging, labels, ingredients, Nutri-Score, and product image (when available).
   - If alternatives found:  
     - If Eco or Nutri is A: `Some other choices...`
     - Else: `You may want to consider...`
     - Numbered list: `1. [Brand] [Name] (Score: A)` plus detail bullets per option.
   - If no alternatives or search skipped: return a short explanatory message after the details block.

### Errors

- No products for query → return a clear “no product found” message.
- API/network errors → return a short error message.

### Technical

- Use `fetch` (or axios if preferred).
- Register the tool with `server.tool("find_sustainable_alternative", { product_query: z.string()... }, handler)`.
- Return MCP content as `{ content: [{ type: "text", text: "..." }] }`.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Data source | Open Food Facts (world.openfoodfacts.org) |
| Fallback enrichment | Brave Search API + OpenAI (estimated fields) |
| Step 1 API | CGI search: `cgi/search.pl?search_terms=...&json=1` |
| Step 3 API | v2 search by `categories_tags` + client-side filter for grade a/b (CGI does not support grade filter) |
| “Lower than B” | Any grade that is not 'a' or 'b' (c, d, e, unknown, empty) |
| Alternatives count | Up to 3, first matching A in category |

## Files

- **Server entry / tool:** `server/src/index.ts` — MCP server, `find_sustainable_alternative` handler, widget resource registration.
- **Dev server entry:** `server/src/dev.ts` — Express server for local dev.
- **Widget UI:** `web/src/widgets/green-scanner.tsx` — UI for entering a product name and viewing results.
- **MCP middleware:** `server/src/middleware.ts` — `/mcp` route and Streamable HTTP transport.

Keep this spec updated when changing tool behavior, APIs, or response format.
