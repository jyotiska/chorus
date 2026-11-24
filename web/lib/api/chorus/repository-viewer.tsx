"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HarnessClient, type RepositoryFile } from "./harness-client";
import styles from "./harness-workspace.module.css";

const client = new HarnessClient();
const grammars = {
  bash: () => import("highlight.js/lib/languages/bash"),
  css: () => import("highlight.js/lib/languages/css"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  python: () => import("highlight.js/lib/languages/python"),
  sql: () => import("highlight.js/lib/languages/sql"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};
type Language = keyof typeof grammars;
const languages: Record<string, Language> = {
  bash: "bash", css: "css", htm: "xml", html: "xml", js: "javascript", jsx: "javascript", cjs: "javascript",
  mjs: "javascript", json: "json", md: "markdown", markdown: "markdown", py: "python", sh: "bash",
  sql: "sql", ts: "typescript", tsx: "typescript", mts: "typescript", svg: "xml", xml: "xml", yaml: "yaml", yml: "yaml",
};

function Code({ source, language }: { source: string; language?: Language }) {
  const [highlight, setHighlight] = useState<{ source: string; language: Language; html: string }>();
  useEffect(() => {
    if (!language || !source) return;
    let current = true;
    void Promise.all([import("highlight.js/lib/core"), grammars[language]()]).then(([{ default: engine }, grammar]) => {
      if (!current) return;
      if (!engine.getLanguage(language)) engine.registerLanguage(language, grammar.default);
      setHighlight({ source, language, html: engine.highlight(source, { language, ignoreIllegals: true }).value });
    }).catch(() => {});
    return () => { current = false; };
  }, [source, language]);
  const html = highlight?.source === source && highlight.language === language ? highlight.html : undefined;
  return <pre className={styles.sourceCode} tabIndex={0} aria-label="Source code">
    {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{source}</code>}
  </pre>;
}

function relativePath(path: string, href: string) {
  if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null;
  try {
    const parts = href.startsWith("/") ? [] : path.split("/").slice(0, -1);
    const [address] = href.split(/[?#]/);
    for (const part of decodeURIComponent(address).split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (part.includes("\\") || part.includes("\0")) return null;
      else parts.push(part);
    }
    return parts.length ? parts.join("/") : null;
  } catch {
    return null;
  }
}

export function RepositoryFileViewer({ file, id, branch, revision, path, openFile }: {
  file: RepositoryFile; id: string; branch: string; revision: string; path: string; openFile?: (path: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  if (file.status !== "text") {
    return <p className={styles.muted}>{file.status === "binary" ? "Binary file." : "File exceeds the 128 KB preview limit."}</p>;
  }
  const source = file.content ?? "";
  const suffix = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  const language = Object.hasOwn(languages, suffix) ? languages[suffix] : undefined;
  const markdown = language === "markdown";
  return <>
    {markdown && <div role="group" aria-label="Markdown view" className={`${styles.repositoryActions} ${styles.fileModes}`}>
      <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>Preview</button>
      <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>Raw</button>
    </div>}
    {!source ? <p className={styles.muted}>(empty file)</p> : markdown && !raw ? (
      <div className={`${styles.markdown} ${styles.repositoryMarkdown}`} aria-label="Markdown preview">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          a: ({ children, href }) => {
            if (href?.startsWith("#")) return <a href={href}>{children}</a>;
            if (href && /^(https?:|mailto:)/i.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
            const target = href && relativePath(path, href);
            return target && openFile ? <button className={styles.repositoryLink} onClick={() => openFile(target)}>{children}</button> : <span>{children}</span>;
          },
          img: ({ alt, src }) => {
            const target = typeof src === "string" && relativePath(path, src);
            if (!target || !/\.(png|jpe?g|gif)$/i.test(target)) return <span>{alt || "Image omitted"}</span>;
            // Committed images have no layout metadata and must use the authenticated-size repository route.
            // eslint-disable-next-line @next/next/no-img-element
            return <img alt={alt || ""} loading="lazy" src={client.repositoryImage(id, branch, revision, target)} />;
          },
        }}>{source}</ReactMarkdown>
      </div>
    ) : <Code source={source} language={markdown ? undefined : language} />}
  </>;
}
