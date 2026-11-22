import { BROWSER_HELD_TEXT, browserActError } from "../../shared/browser-handoff";
import type { BrowserControl } from "../../tools/types";

export function gateBrowser(
  browser: BrowserControl,
  state: {
    held(agentId: string): boolean;
    needsSnapshot(agentId: string): boolean;
    noteSnapshot(agentId: string): void;
  },
): BrowserControl {
  const blocked = (agentId: string) => {
    const error = browserActError({
      held: state.held(agentId),
      needsSnapshot: state.needsSnapshot(agentId),
    });
    if (error) throw new Error(error);
  };
  return {
    async navigate(agentId, url) {
      blocked(agentId);
      return browser.navigate(agentId, url);
    },
    async click(agentId, selector) {
      blocked(agentId);
      return browser.click(agentId, selector);
    },
    async type(agentId, selector, text, submit) {
      blocked(agentId);
      return browser.type(agentId, selector, text, submit);
    },
    async snapshot(agentId) {
      if (state.held(agentId)) throw new Error(BROWSER_HELD_TEXT);
      const text = await browser.snapshot(agentId);
      state.noteSnapshot(agentId);
      return text;
    },
    async capture(agentId, url, options) {
      blocked(agentId);
      return browser.capture(agentId, url, options);
    },
  };
}
