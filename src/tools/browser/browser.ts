import { asRecord, optionalBoolean, requiredString } from "../args";
import type { AppTool } from "../types";

export const browserTools: AppTool[] = [
  {
    name: "browser_navigate",
    description: "Open an http or https URL in this agent's local browser.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http or https URL" },
      },
      required: ["url"],
    },
    handler: async (args, ctx) => {
      const url = requiredString(asRecord(args), "url");
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("url must be an absolute http or https URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http and https URLs are allowed");
      }
      return ctx.browser.navigate(ctx.agentId, parsed.toString());
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the current page as an accessibility snapshot. Use it before clicking or typing. Selectors may be Playwright selectors such as role=link[name=\"Learn more\"] or text=Example Domain.",
    parameters: { type: "object", properties: {} },
    handler: async (_args, ctx) => ctx.browser.snapshot(ctx.agentId),
  },
  {
    name: "browser_click",
    description: "Click an element. selector is a Playwright selector taken from the latest snapshot.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Playwright selector" },
      },
      required: ["selector"],
    },
    handler: async (args, ctx) => {
      const selector = requiredString(asRecord(args), "selector");
      return ctx.browser.click(ctx.agentId, selector);
    },
  },
  {
    name: "browser_type",
    description: "Fill an input and optionally press Enter. selector is a Playwright selector.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean", description: "Press Enter after filling" },
      },
      required: ["selector", "text"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      return ctx.browser.type(
        ctx.agentId,
        requiredString(record, "selector"),
        requiredString(record, "text"),
        optionalBoolean(record, "submit"),
      );
    },
  },
];
