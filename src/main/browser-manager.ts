import fs from "fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BrowserPreview } from "../shared/types";
import { profileDir } from "./paths";

const channels: Array<"msedge" | "chrome" | null> = ["msedge", "chrome", null];

export class BrowserManager {
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly launching = new Map<string, Promise<BrowserContext>>();

  async navigate(agentId: string, url: string): Promise<string> {
    const page = await this.page(agentId);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return `url: ${page.url()}\ntitle: ${await page.title()}`;
  }

  async snapshot(agentId: string): Promise<string> {
    const page = await this.page(agentId);
    let text = "";
    try {
      text = await page.locator("body").ariaSnapshot();
    } catch {
      text = await page.locator("body").innerText();
    }
    const url = page.url();
    const title = await page.title();
    const body = text.length > 20000 ? `${text.slice(0, 20000)}\n…truncated` : text;
    return `url: ${url}\ntitle: ${title}\n${body}`;
  }

  async preview(agentId: string): Promise<BrowserPreview | null> {
    const context = this.contexts.get(agentId);
    const page = context?.pages().find((candidate) => !candidate.isClosed());
    if (!page) return null;
    try {
      const image = await page.screenshot({ type: "jpeg", quality: 55, timeout: 5000, animations: "disabled" });
      return {
        image: `data:image/jpeg;base64,${image.toString("base64")}`,
        url: page.url(),
        title: await page.title(),
      };
    } catch {
      return null;
    }
  }

  async focus(agentId: string): Promise<boolean> {
    const context = this.contexts.get(agentId);
    const page = context?.pages().find((candidate) => !candidate.isClosed());
    if (!page) return false;
    try {
      await page.bringToFront();
      return true;
    } catch {
      return false;
    }
  }

  async click(agentId: string, selector: string): Promise<string> {
    const page = await this.page(agentId);
    await page.locator(selector).click({ timeout: 10000 });
    return `clicked ${selector} on ${page.url()}`;
  }

  async type(agentId: string, selector: string, text: string, submit: boolean): Promise<string> {
    const page = await this.page(agentId);
    const locator = page.locator(selector);
    await locator.fill(text, { timeout: 10000 });
    if (submit) await locator.press("Enter");
    return `typed into ${selector}${submit ? " and pressed Enter" : ""}`;
  }

  async close(agentId: string): Promise<void> {
    const context = this.contexts.get(agentId);
    this.contexts.delete(agentId);
    if (context) await context.close();
  }

  async closeAll(): Promise<void> {
    const jobs = [...this.contexts.values()].map((context) => context.close().catch(() => undefined));
    this.contexts.clear();
    await Promise.all(jobs);
  }

  async deleteProfile(agentId: string): Promise<void> {
    await this.close(agentId);
    fs.rmSync(profileDir(agentId), { recursive: true, force: true });
  }

  private async page(agentId: string): Promise<Page> {
    const context = await this.context(agentId);
    const open = context.pages();
    return open[0] ?? context.newPage();
  }

  private async context(agentId: string): Promise<BrowserContext> {
    const existing = this.contexts.get(agentId);
    if (existing) return existing;
    const pending = this.launching.get(agentId);
    if (pending) return pending;

    const job = this.launch(agentId);
    this.launching.set(agentId, job);
    try {
      const context = await job;
      this.contexts.set(agentId, context);
      context.on("close", () => {
        if (this.contexts.get(agentId) === context) this.contexts.delete(agentId);
      });
      return context;
    } finally {
      this.launching.delete(agentId);
    }
  }

  private async launch(agentId: string): Promise<BrowserContext> {
    const dir = profileDir(agentId);
    fs.mkdirSync(dir, { recursive: true });
    const errors: string[] = [];
    for (const channel of channels) {
      try {
        return await chromium.launchPersistentContext(dir, {
          headless: false,
          viewport: { width: 1280, height: 800 },
          ...(channel ? { channel } : {}),
        });
      } catch (error) {
        const label = channel ?? "playwright-chromium";
        errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(
      `Could not open a local browser. ${errors.join(" | ")}. If Chromium is missing, run npx playwright install chromium in the app folder.`,
    );
  }
}
