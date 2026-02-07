import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
declare const server: McpServer;
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
export declare function buildSustainableAlternativeResult(product_query: string, imageBase64?: string): Promise<SustainableResult>;
export default server;
