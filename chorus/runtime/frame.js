"use strict";

const parentOrigin = new URLSearchParams(location.search).get("parent");
const frame = document.querySelector("iframe");
const entries = [];
const documents = new WeakMap();
let nextDocument = 0;
let index = -1;
let destination;
let expected = new URL("/", location.href);
let events;

function child() {
  try {
    const window = frame.contentWindow;
    const url = new URL(window.location.href);
    return url.origin === location.origin ? { window, url, document: window.document } : null;
  } catch {
    return null;
  }
}

function publish(url, available) {
  parent.postMessage({
    type: "chorus-preview-location", url: url.href, available,
    back: index > 0 || (!available && index >= 0), forward: available && index < entries.length - 1,
  }, parentOrigin);
}

function observe(event) {
  const page = child();
  if (!page || page.document.querySelector('meta[name="chorus-preview-blocked"]')) {
    const blocked = page?.url ?? expected;
    expected = blocked;
    publish(blocked, false);
    return;
  }
  if (!documents.has(page.document)) documents.set(page.document, ++nextDocument);
  const entry = { url: page.url, document: documents.get(page.document), key: page.window.navigation?.currentEntry?.key };
  if (destination !== undefined) {
    index = destination;
    entries[index] = entry;
    destination = undefined;
  } else if (entries[index]?.url.href === page.url.href || event?.navigationType === "replace") {
    if (index >= 0) entries[index] = entry;
  } else {
    const existing = entry.key ? entries.findIndex((item) => item.key === entry.key) : -1;
    if (existing >= 0) {
      index = existing;
      entries[index] = entry;
    } else {
      entries.splice(++index, entries.length, entry);
      if (entries.length > 100) {
        entries.shift();
        index--;
      }
    }
  }
  expected = page.url;
  publish(page.url, true);
}

frame.addEventListener("load", () => {
  events?.abort();
  events = new AbortController();
  const page = child();
  if (page) {
    const options = { signal: events.signal };
    const navigation = page.window.navigation;
    navigation?.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);
      if (url.origin === location.origin) expected = url;
    }, options);
    navigation?.addEventListener("currententrychange", observe, options);
    page.window.addEventListener("hashchange", observe, options);
  }
  observe();
});

async function traverse(target) {
  const entry = entries[target];
  if (!entry) return;
  destination = target;
  expected = entry.url;
  const page = child();
  const navigation = page?.window.navigation;
  // In a sandbox some browsers treat cross-document traversal as an attempt
  // to navigate the top-level page. Use the recorded URL for those entries.
  if (navigation && entry.document === documents.get(page.document) && entry.key) {
    try {
      const result = navigation.traverseTo(entry.key);
      await Promise.all([result.committed, result.finished]);
      return;
    } catch { /* The browser declined traversal in the sandbox. */ }
  }
  frame.src = entry.url.href;
}

addEventListener("message", (event) => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.type !== "chorus-preview-command") return;
  const page = child();
  switch (event.data.action) {
    case "open": {
      let url;
      try { url = new URL(event.data.url); } catch { return; }
      if (url.origin !== location.origin || url.pathname.startsWith("/.chorus-preview/")) return;
      expected = url;
      destination = undefined;
      frame.src = url.href;
      break;
    }
    case "refresh":
      if (page) page.window.location.reload();
      else frame.src = expected.href;
      break;
    case "back":
      void traverse(entries[index]?.url.href === expected.href ? index - 1 : index);
      break;
    case "forward":
      void traverse(index + 1);
      break;
  }
});

frame.src = "/";
