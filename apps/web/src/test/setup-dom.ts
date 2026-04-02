import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

const { window } = dom;

window.HTMLElement.prototype.scrollIntoView = () => undefined;

type LegacyHTMLElementPrototype = typeof window.HTMLElement.prototype & {
  attachEvent: () => void;
  detachEvent: () => void;
};

const legacyHTMLElementPrototype = window.HTMLElement
  .prototype as LegacyHTMLElementPrototype;

legacyHTMLElementPrototype.attachEvent = () => undefined;
legacyHTMLElementPrototype.detachEvent = () => undefined;

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  location: window.location,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Node: window.Node,
  DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver,
  SVGElement: window.SVGElement,
  Event: window.Event,
  InputEvent: window.InputEvent,
  SubmitEvent: window.SubmitEvent,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  CustomEvent: window.CustomEvent,
  FormData: window.FormData,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle: number) => window.clearTimeout(handle),
  scrollTo: () => undefined,
});

window.scrollTo = () => undefined;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
