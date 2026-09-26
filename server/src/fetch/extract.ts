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
      const text = clean(child.textContent ?? "");
      if (text.length === 0) continue;
      if (PROTECTED_TAGS.has(tag)) {
        addProtected(text, sanitize(child));
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

/**
 * Reference markers, edit links and "[citation needed]" are page furniture,
 * not prose. Left in, the segmenter treats them as sentences of their own.
 */
function clean(text: string): string {
  return text
    .replace(/\[\s*(?:\d+|citation needed|edit|note \d+)\s*\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/**
 * Tags a protected block may keep. Everything else is unwrapped to its text,
 * and every attribute goes — the UI renders this markup directly, so nothing
 * from the page (scripts, handlers, tracking pixels, links) may survive.
 */
const KEEP_TAGS = new Set([
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "CAPTION",
  "PRE",
  "CODE",
  "BLOCKQUOTE",
  "P",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "STRONG",
  "EM",
  "B",
  "I",
  "FIGCAPTION",
]);
const DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "NOSCRIPT",
  "SVG",
  "IMG",
  "VIDEO",
  "BUTTON",
  "FORM",
  "INPUT",
]);

/** Structure only: a recipe's list stays a list, and nothing else comes along. */
function sanitize(root: Element): string {
  const doc = root.ownerDocument;
  const walk = (node: Element): Node | null => {
    const tag = node.tagName.toUpperCase();
    if (DROP_TAGS.has(tag)) return null;
    const children: Node[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        children.push(doc.createTextNode(child.textContent ?? ""));
      } else if (child.nodeType === 1) {
        const kept = walk(child as Element);
        if (kept) children.push(kept);
      }
    }
    if (!KEEP_TAGS.has(tag)) {
      // Unwrap: hand the children up in a fragment.
      const frag = doc.createDocumentFragment();
      for (const c of children) frag.appendChild(c);
      return frag;
    }
    const el = doc.createElement(tag.toLowerCase());
    for (const c of children) el.appendChild(c);
    return el;
  };
  const out = walk(root);
  if (!out) return "";
  const holder = doc.createElement("div");
  holder.appendChild(out);
  return holder.innerHTML;
}

/**
 * Pages with nothing to unslop. A mistyped URL is the likeliest thing to go
 * wrong in front of an audience, and without this the pipeline runs happily
 * over a 404 and presents its navigation menu as a reader view.
 */
const NO_ARTICLE_TITLE =
  /\b(404|page not found|not found|error 404|no longer exists|access denied|forbidden)\b/i;

/** Below this many words of prose there is nothing worth judging. */
const MIN_PROSE_WORDS = 60;

export function findMissingArticle(
  extracted: Extracted,
  countWords: (text: string) => number,
): string | undefined {
  if (NO_ARTICLE_TITLE.test(extracted.title)) {
    return `That page is an error page, not an article ("${extracted.title.trim()}").`;
  }
  const prose = extracted.blocks
    .filter((b) => b.kind === "prose")
    .reduce((n, b) => n + countWords(b.text), 0);
  if (prose < MIN_PROSE_WORDS) {
    return "That page has no article on it — Unslop found nothing but navigation and boilerplate.";
  }
  return undefined;
}
