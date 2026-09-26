import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Block, Unit } from "../types.js";
import { splitSentences } from "../segment.js";

/** Tags that come through untouched: this is what keeps a recipe's ingredients and steps intact. */
const PROTECTED_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "TABLE",
  "PRE",
  "CODE",
  "BLOCKQUOTE",
  "FIGURE",
  "FIGCAPTION",
  "DL",
  "HR",
]);

const CONTAINER_TAGS = new Set([
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "HEADER",
  "FOOTER",
  "ASIDE",
]);

export type Extracted = {
  title: string;
  blocks: Block[];
  units: Unit[];
};

/**
 * Pull the main article out of a page and split it into blocks. Only prose
 * paragraphs become sentence units; everything else is `protected` and is
 * never sent to Jev for cutting.
 */
export function extractArticle(html: string, url: string): Extracted {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title ?? dom.window.document.title ?? "";
  const contentHtml =
    article?.content ?? dom.window.document.body?.innerHTML ?? "";
  const content = new JSDOM(`<body>${contentHtml}</body>`, { url }).window
    .document.body;

  const blocks: Block[] = [];
  const units: Unit[] = [];
  let sentenceIndex = 0;
  let blockIndex = 0;

  const addProtected = (text: string, outerHTML?: string) => {
    const id = `p${blockIndex++}`;
    const unit: Unit = {
      id: `${id}x`,
      kind: "protected",
      paragraphId: id,
      text,
    };
    units.push(unit);
    const block: Block = { id, kind: "protected", text, units: [unit] };
    if (outerHTML) block.html = outerHTML;
    blocks.push(block);
  };

  const addProse = (text: string) => {
    const id = `p${blockIndex++}`;
    const blockUnits = splitSentences(text).map((s) => {
      const unit: Unit = {
        id: `s${sentenceIndex++}`,
        kind: "sentence",
        paragraphId: id,
        text: s,
      };
      units.push(unit);
      return unit;
    });
    if (blockUnits.length === 0) return;
    blocks.push({ id, kind: "prose", text, units: blockUnits });
  };

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toUpperCase();
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length === 0) continue;
      if (PROTECTED_TAGS.has(tag)) {
        addProtected(text, child.outerHTML);
      } else if (tag === "P") {
        addProse(text);
      } else if (CONTAINER_TAGS.has(tag)) {
        walk(child);
      } else {
        addProse(text);
      }
    }
  };

  walk(content);
  if (title) {
    const id = `p${blockIndex++}`;
    const unit: Unit = {
      id: `${id}x`,
      kind: "protected",
      paragraphId: id,
      text: title,
    };
    units.unshift(unit);
    blocks.unshift({
      id,
      kind: "protected",
      text: title,
      html: `<h1>${escapeHtml(title)}</h1>`,
      units: [unit],
    });
  }

  return { title, blocks, units };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
