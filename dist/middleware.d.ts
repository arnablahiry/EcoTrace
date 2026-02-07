import type { NextFunction, Request, Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const mcp: (server: McpServer) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
