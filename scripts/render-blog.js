const posts = window.BLOG_POSTS ?? [];

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPostId = (post) => post.slug ?? slugify(post.title);

const getRequestedPostId = () => {
  const queryId = new URLSearchParams(window.location.search).get("id");

  if (queryId) {
    return queryId;
  }

  const pathMatch = window.location.pathname.match(/^\/post\/([^/]+)\/?$/);

  return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
};

const formatBlogDate = (dateValue) => {
  const date = new Date(`${dateValue}T00:00:00`);

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(date);
};

const isSkippableLine = (line) => {
  const trimmed = line.trim();

  return (
    !trimmed ||
    /^[-*_]{3,}$/.test(trimmed) ||
    /^\\?\*\\?\*\\?\*/.test(trimmed)
  );
};

const preprocessPostMarkdown = (markdown = "", post = {}) => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let authors = post.authors ?? "";
  const abstractLines = [];
  let bodyStart = 0;
  let index = 0;

  while (index < lines.length && isSkippableLine(lines[index])) {
    index += 1;
  }

  const firstLine = unescapeMarkdownSyntax(lines[index] ?? "").trim();
  const titleMatch = firstLine.match(/^#\s+(.+)/);

  if (titleMatch) {
    index += 1;

    while (index < lines.length && isSkippableLine(lines[index])) {
      index += 1;
    }
  }

  while (index < lines.length) {
    const line = unescapeMarkdownSyntax(lines[index]).trim();

    if (!line) {
      index += 1;
      continue;
    }

    const byMatch = line.match(/^By:\s*(.+)/i);

    if (byMatch) {
      authors = authors ? `${authors}, ${byMatch[1]}` : byMatch[1];
      index += 1;
      continue;
    }

    const advisedMatch = line.match(/^Advised by:\s*(.+)/i);

    if (advisedMatch) {
      const advisedText = `Advised by: ${advisedMatch[1]}`;
      authors = authors ? `${authors}. ${advisedText}` : advisedText;
      index += 1;
      continue;
    }

    break;
  }

  while (index < lines.length && isSkippableLine(lines[index])) {
    index += 1;
  }

  const nextLine = unescapeMarkdownSyntax(lines[index] ?? "").trim();
  const abstractHeadingMatch = nextLine.match(/^#\s*Abstract\s*$/i);

  if (abstractHeadingMatch) {
    index += 1;

    while (index < lines.length) {
      const line = unescapeMarkdownSyntax(lines[index]).trim();

      if (/^#{1,2}\s+/.test(line)) {
        break;
      }

      abstractLines.push(lines[index]);
      index += 1;
    }
  } else {
    while (index < lines.length) {
      const line = unescapeMarkdownSyntax(lines[index]).trim();

      if (/^#{1,6}\s+/.test(line)) {
        break;
      }

      if (isSkippableLine(lines[index])) {
        let peek = index + 1;

        while (peek < lines.length && isSkippableLine(lines[peek])) {
          peek += 1;
        }

        if (
          peek < lines.length &&
          /^#{1,6}\s+/.test(unescapeMarkdownSyntax(lines[peek]).trim())
        ) {
          break;
        }
      }

      abstractLines.push(lines[index]);
      index += 1;
    }
  }

  bodyStart = index;

  return {
    authors: authors.trim(),
    abstractMarkdown: abstractLines.join("\n").trim(),
    bodyMarkdown: lines.slice(bodyStart).join("\n").trim(),
  };
};

// Raw-text markdown endpoint for a post. Articles render client-side, so
// pointing a model at /post/<slug> gives it an empty shell; this URL returns
// the actual article text, so any model can read it reliably.
const getMarkdownUrl = (post) =>
  `${window.location.origin}/markdown/${encodeURIComponent(getPostId(post))}`;

// Point the model at the raw-markdown endpoint and ask it to read that. Short
// and reliable — no article text stuffed into the query string.
const buildLinkPrompt = (post) => {
  return (
    `Please open and read this JW Labs research article (raw markdown), then ` +
    `help me understand and discuss it: ${getMarkdownUrl(post)}\n\n` +
    `Title: ${post.title}`
  );
};

// A richer prompt with the full article text inlined, for targets that tolerate
// long query strings (Claude). Falls back to the link prompt for long articles.
const buildInlinePrompt = (post) => {
  const SAFE_INLINE_LENGTH = 6000;

  if (!post.markdown || post.markdown.length > SAFE_INLINE_LENGTH) {
    return buildLinkPrompt(post);
  }

  return (
    `I'm reading this JW Labs research article and I'd like your help ` +
    `understanding and discussing it.\n\n` +
    `Title: ${post.title}\n\n` +
    `Here is the full article for context:\n\n${post.markdown}`
  );
};

const AI_TARGETS = [
  { label: "Claude", base: "https://claude.ai/new", buildPrompt: buildInlinePrompt },
  { label: "ChatGPT", base: "https://chatgpt.com/", buildPrompt: buildLinkPrompt },
];

const createAskAiBar = (post) => {
  const bar = document.createElement("div");
  bar.className = "ask-ai";

  const label = document.createElement("span");
  label.className = "ask-ai-label";
  label.textContent = "Discuss with";
  bar.append(label);

  AI_TARGETS.forEach(({ label: name, base, buildPrompt }) => {
    const link = document.createElement("a");
    link.className = "ask-ai-link";
    link.href = `${base}?q=${encodeURIComponent(buildPrompt(post))}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = name;
    bar.append(link);
  });

  // Raw-markdown endpoint: plain text, readable by any model or by hand.
  const markdownLink = document.createElement("a");
  markdownLink.className = "ask-ai-link ask-ai-link-alt";
  markdownLink.href = getMarkdownUrl(post);
  markdownLink.target = "_blank";
  markdownLink.rel = "noopener noreferrer";
  markdownLink.textContent = "Open markdown";
  bar.append(markdownLink);

  return bar;
};

// Canonical, shareable URL for a post — the clean /post/<slug> form, regardless
// of whether the reader arrived via ?id= or the pretty path.
const getShareUrl = (post) =>
  `${window.location.origin}/post/${encodeURIComponent(getPostId(post))}`;

const SHARE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="18" cy="5" r="3"></circle>' +
  '<circle cx="6" cy="12" r="3"></circle>' +
  '<circle cx="18" cy="19" r="3"></circle>' +
  '<line x1="8.6" y1="10.5" x2="15.4" y2="6.5"></line>' +
  '<line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line>' +
  "</svg>";

const createShareButton = (post) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "share-button";
  button.title = "Copy link to this post";
  button.setAttribute("aria-label", "Copy link to this post");
  button.innerHTML = SHARE_ICON_SVG;

  let resetTimer = null;

  const showCopied = () => {
    button.classList.add("is-copied");
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.classList.remove("is-copied");
    }, 2000);
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    // Fallback for insecure contexts / older browsers.
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.append(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  };

  button.addEventListener("click", async () => {
    try {
      await copyText(getShareUrl(post));
      showCopied();
    } catch {
      // If the clipboard is unavailable, fall back to a prompt so the reader
      // can still grab the link manually.
      window.prompt("Copy this link:", getShareUrl(post));
    }
  });

  return button;
};

const appendAuthorsWithLinks = (root, authorsText) => {
  const linkable = (window.AUTHORS ?? []).filter(
    (author) => author.email || author.github || author.x,
  );

  if (linkable.length === 0) {
    root.textContent = authorsText;
    return;
  }

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = linkable
    .map((author) => author.name)
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${names.map(escapeRegExp).join("|")})`, "g");

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(authorsText)) !== null) {
    if (match.index > lastIndex) {
      root.append(
        document.createTextNode(authorsText.slice(lastIndex, match.index)),
      );
    }

    const link = document.createElement("a");
    link.className = "author-link";
    link.href = `/team.html#${slugify(match[1])}`;
    link.textContent = match[1];
    root.append(link);

    lastIndex = pattern.lastIndex;
  }

  root.append(document.createTextNode(authorsText.slice(lastIndex)));
};

const appendInlineMarkdown = (root, text) => {
  const { protectedText, mathSegments } = protectMathSegments(text);
  const cleanText = unescapeMarkdownSyntax(protectedText);
  const inlinePattern =
    /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = inlinePattern.exec(cleanText)) !== null) {
    appendTextWithMathSegments(
      root,
      cleanText.slice(lastIndex, match.index),
      mathSegments,
    );

    if (match[2] && match[3]) {
      const link = document.createElement("a");
      link.href = match[3];
      appendTextWithMathSegments(link, match[2], mathSegments);
      root.append(link);
    } else if (match[4]) {
      const code = document.createElement("code");
      code.textContent = restoreMathSegments(match[4], mathSegments);
      root.append(code);
    } else if (match[5]) {
      const strong = document.createElement("strong");
      appendTextWithMathSegments(strong, match[5], mathSegments);
      root.append(strong);
    } else if (match[6]) {
      const emphasis = document.createElement("em");
      appendTextWithMathSegments(emphasis, match[6], mathSegments);
      root.append(emphasis);
    }

    lastIndex = inlinePattern.lastIndex;
  }

  appendTextWithMathSegments(root, cleanText.slice(lastIndex), mathSegments);
};

const createParagraph = (text) => {
  const paragraph = document.createElement("p");
  appendInlineMarkdown(paragraph, text);
  return paragraph;
};

const createList = (items = [], ordered = false) => {
  const list = document.createElement(ordered ? "ol" : "ul");

  items.forEach((item) => {
    const value = typeof item === "string" ? null : item.value;
    const text = typeof item === "string" ? item : item.text;
    const listItem = document.createElement("li");

    if (ordered && Number.isInteger(value)) {
      listItem.value = value;
    }

    appendInlineMarkdown(listItem, text);
    list.append(listItem);
  });

  return list;
};

const createQuote = (text) => {
  const quote = document.createElement("blockquote");
  appendInlineMarkdown(quote, text);
  return quote;
};

const createHeadingId = (text, usedIds) => {
  const base = slugify(text) || "section";
  let id = base;
  let suffix = 2;

  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(id);
  return id;
};

const createHeading = (level, text, usedIds) => {
  const heading = document.createElement(`h${Math.min(level + 1, 6)}`);
  heading.id = createHeadingId(text, usedIds);
  appendInlineMarkdown(heading, text);
  return heading;
};

const CODE_BLOCK_COLLAPSED_LINES = 2;

const createCodeBlock = (lines, language = "") => {
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  if (language) {
    code.dataset.language = language;
    // highlight.js reads the language-* class to pick a grammar
    code.className = `language-${language}`;
  }

  code.textContent = lines.join("\n");
  pre.append(code);

  if (lines.length <= CODE_BLOCK_COLLAPSED_LINES) {
    return pre;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "code-block is-collapsed";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "code-block-toggle";
  toggle.textContent = "Expand";
  toggle.setAttribute("aria-expanded", "false");

  toggle.addEventListener("click", () => {
    const collapsed = wrapper.classList.toggle("is-collapsed");
    toggle.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  wrapper.append(pre, toggle);
  return wrapper;
};

const unescapeMarkdownSyntax = (text = "") =>
  text.replace(/\\([\\`*_{}\[\]()#+\-.!<>|=~])/g, "$1");

const normalizeLine = (line) =>
  unescapeMarkdownSyntax(line.trimStart()).replace(/\s+$/, "");

const trimMarkdownLine = (line) => line.trimStart().replace(/\s+$/, "");

const MATH_PLACEHOLDER_PATTERN = /\uE000(\d+)\uE001/g;

const mathDelimiters = [
  { left: "$$", right: "$$" },
  { left: "\\[", right: "\\]" },
  { left: "\\(", right: "\\)" },
  { left: "$", right: "$" },
];

const blockMathDelimiters = mathDelimiters.slice(0, 2);

const isEscapedAt = (text, index) => {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
};

const findMathStart = (text, startIndex) => {
  let next = null;

  mathDelimiters.forEach((delimiter) => {
    let index = text.indexOf(delimiter.left, startIndex);

    while (index !== -1) {
      const isSingleDollarInsideDisplay =
        delimiter.left === "$" &&
        (text[index + 1] === "$" || text[index - 1] === "$");

      if (!isEscapedAt(text, index) && !isSingleDollarInsideDisplay) {
        break;
      }

      index = text.indexOf(delimiter.left, index + delimiter.left.length);
    }

    if (index !== -1 && (!next || index < next.index)) {
      next = { ...delimiter, index };
    }
  });

  return next;
};

const findClosingMathDelimiter = (text, delimiter, startIndex) => {
  let index = text.indexOf(delimiter.right, startIndex);

  while (index !== -1) {
    const isSingleDollarInsideDisplay =
      delimiter.right === "$" &&
      (text[index + 1] === "$" || text[index - 1] === "$");

    if (!isEscapedAt(text, index) && !isSingleDollarInsideDisplay) {
      return index;
    }

    index = text.indexOf(delimiter.right, index + delimiter.right.length);
  }

  return -1;
};

const protectMathSegments = (text = "") => {
  const mathSegments = [];
  let protectedText = "";
  let index = 0;

  while (index < text.length) {
    const start = findMathStart(text, index);

    if (!start) {
      protectedText += text.slice(index);
      break;
    }

    const contentStart = start.index + start.left.length;
    const end = findClosingMathDelimiter(text, start, contentStart);

    if (end === -1) {
      protectedText += text.slice(index, contentStart);
      index = contentStart;
      continue;
    }

    protectedText += text.slice(index, start.index);
    protectedText += `\uE000${mathSegments.length}\uE001`;
    mathSegments.push(text.slice(start.index, end + start.right.length));
    index = end + start.right.length;
  }

  return { protectedText, mathSegments };
};

const appendTextWithMathSegments = (root, text, mathSegments) => {
  let lastIndex = 0;
  let match;

  MATH_PLACEHOLDER_PATTERN.lastIndex = 0;

  while ((match = MATH_PLACEHOLDER_PATTERN.exec(text)) !== null) {
    root.append(document.createTextNode(text.slice(lastIndex, match.index)));
    root.append(document.createTextNode(mathSegments[Number(match[1])] ?? match[0]));
    lastIndex = MATH_PLACEHOLDER_PATTERN.lastIndex;
  }

  root.append(document.createTextNode(text.slice(lastIndex)));
};

const restoreMathSegments = (text, mathSegments) =>
  text.replace(
    MATH_PLACEHOLDER_PATTERN,
    (match, index) => mathSegments[Number(index)] ?? match,
  );

const getBlockMathDelimiter = (line = "") => {
  const trimmed = line.trimStart();

  return blockMathDelimiters.find((delimiter) =>
    trimmed.startsWith(delimiter.left),
  );
};

const lineClosesBlockMath = (line, delimiter, isOpeningLine) => {
  const trimmed = line.trimEnd();

  if (delimiter.left === delimiter.right && isOpeningLine) {
    return trimmed.indexOf(delimiter.right, delimiter.left.length) !== -1;
  }

  return (
    trimmed.endsWith(delimiter.right) &&
    !isEscapedAt(trimmed, trimmed.length - delimiter.right.length)
  );
};

const collectMathBlock = (lines, startIndex) => {
  const delimiter = getBlockMathDelimiter(lines[startIndex]);

  if (!delimiter) {
    return null;
  }

  const mathLines = [lines[startIndex].trim()];

  if (lineClosesBlockMath(mathLines[0], delimiter, true)) {
    return { index: startIndex + 1, source: mathLines.join("\n") };
  }

  let index = startIndex + 1;

  while (index < lines.length) {
    mathLines.push(lines[index].trimEnd());

    if (lineClosesBlockMath(lines[index], delimiter, false)) {
      return { index: index + 1, source: mathLines.join("\n") };
    }

    index += 1;
  }

  return null;
};

const createMathBlock = (source) => {
  const block = document.createElement("div");
  block.className = "math-block";
  block.textContent = source;
  return block;
};

const extractReferenceDefinitions = (lines) => {
  const references = {};
  const contentLines = [];

  lines.forEach((line) => {
    const match = normalizeLine(line).match(/^\[([^\]]+)]:\s*<?([^>]+)>?$/);

    if (match) {
      references[match[1].toLowerCase()] = match[2].trim();
    } else {
      contentLines.push(line);
    }
  });

  return { contentLines, references };
};

const isVideoSource = (src = "") => /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(src);

const createImage = (alt, src, fallbackSrc = "") => {
  const figure = document.createElement("figure");

  if (isVideoSource(src)) {
    const video = document.createElement("video");

    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    video.setAttribute("autoplay", "");
    video.setAttribute("loop", "");
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-label", alt);

    const playVideo = () => {
      const playPromise = video.play();

      if (playPromise) {
        playPromise.catch(() => {});
      }
    };

    video.addEventListener("canplay", playVideo, { once: true });
    figure.append(video);
    queueMicrotask(playVideo);

    if (alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = alt;
      figure.append(caption);
    }

    return figure;
  }

  const image = document.createElement("img");

  image.alt = alt;
  image.loading = src.endsWith(".gif") ? "eager" : "lazy";
  image.src = src;

  if (fallbackSrc && fallbackSrc !== src) {
    image.addEventListener(
      "error",
      () => {
        image.src = fallbackSrc;
      },
      { once: true },
    );
  }

  figure.append(image);

  if (alt) {
    const caption = document.createElement("figcaption");
    caption.textContent = alt;
    figure.append(caption);
  }

  return figure;
};

const resolveImageSource = ({ explicitSrc, referenceKey, references, post }) => {
  if (explicitSrc) {
    return { src: explicitSrc, fallbackSrc: "" };
  }

  if (!referenceKey) {
    return { src: "", fallbackSrc: "" };
  }

  const fallbackSrc = references[referenceKey.toLowerCase()];
  const localSrc = `/content/${getPostId(post)}/${referenceKey}.png`;

  return {
    src: localSrc,
    fallbackSrc,
  };
};

const createTable = (rows) => {
  const wrapper = document.createElement("div");
  const table = document.createElement("table");
  const [headerRow, , ...bodyRows] = rows;
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  wrapper.className = "table-scroll";

  const splitRow = (row) =>
    trimMarkdownLine(row)
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());

  const getMultiplierValue = (cell) => {
    const match = unescapeMarkdownSyntax(cell).match(/^([+-]?\d+(?:\.\d+)?)\s*[×x]$/i);

    return match ? Number.parseFloat(match[1]) : null;
  };

  const header = document.createElement("tr");
  splitRow(headerRow).forEach((cell) => {
    const th = document.createElement("th");
    appendInlineMarkdown(th, cell);
    header.append(th);
  });
  thead.append(header);

  bodyRows.forEach((row) => {
    const tr = document.createElement("tr");

    splitRow(row).forEach((cell) => {
      const td = document.createElement("td");
      const multiplierValue = getMultiplierValue(cell);

      if (multiplierValue !== null && multiplierValue < 1) {
        td.classList.add("is-low-multiplier");
      }

      appendInlineMarkdown(td, cell);
      tr.append(td);
    });

    tbody.append(tr);
  });

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
};

const isBlockStart = (line) =>
  /^#{1,6}\s+/.test(line) ||
  /^>\s?/.test(line) ||
  /^[-*]\s+/.test(line) ||
  /^\d+\.\s+/.test(line) ||
  /^!\[.*\]/.test(line) ||
  /^\|.+\|$/.test(line) ||
  /^```/.test(line);

const getNextNonBlankLineIndex = (lines, startIndex) => {
  let index = startIndex;

  while (index < lines.length && !normalizeLine(lines[index]).trim()) {
    index += 1;
  }

  return index;
};

const collectListItems = (lines, startIndex, itemPattern, createItem) => {
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = normalizeLine(lines[index]);
    const rawLine = trimMarkdownLine(lines[index]);
    const match = line.match(itemPattern);

    if (match) {
      items.push(createItem(rawLine.match(itemPattern) ?? match));
      index += 1;
      continue;
    }

    if (!line.trim()) {
      const nextIndex = getNextNonBlankLineIndex(lines, index + 1);

      if (
        nextIndex < lines.length &&
        itemPattern.test(normalizeLine(lines[nextIndex]))
      ) {
        index = nextIndex;
        continue;
      }
    }

    break;
  }

  return { items, index };
};

const renderMarkdown = (markdown = "", post = {}, usedHeadingIds = new Set()) => {
  const fragment = document.createDocumentFragment();
  const rawLines = markdown.replace(/\r\n/g, "\n").trim().split("\n");
  const { contentLines: lines, references } = extractReferenceDefinitions(rawLines);
  let index = 0;

  while (index < lines.length) {
    const rawLine = trimMarkdownLine(lines[index]);
    const line = normalizeLine(lines[index]);

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeMatch = line.match(/^```(\w+)?/);
    if (codeMatch) {
      const codeLines = [];
      index += 1;

      while (index < lines.length && !/^```/.test(normalizeLine(lines[index]))) {
        codeLines.push(lines[index]);
        index += 1;
      }

      fragment.append(createCodeBlock(codeLines, codeMatch[1]));
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const rawHeadingMatch = rawLine.match(/^(#{1,6})\s+(.+)/) ?? headingMatch;
      fragment.append(
        createHeading(
          rawHeadingMatch[1].length,
          rawHeadingMatch[2],
          usedHeadingIds,
        ),
      );
      index += 1;
      continue;
    }

    const mathBlock = collectMathBlock(lines, index);

    if (mathBlock) {
      fragment.append(createMathBlock(mathBlock.source));
      index = mathBlock.index;
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\](?:\(([^)]+)\)|\[([^\]]*)\])$/);
    if (imageMatch) {
      const rawImageMatch =
        rawLine.match(/^!\[([^\]]*)\](?:\(([^)]+)\)|\[([^\]]*)\])$/) ??
        imageMatch;
      const alt = rawImageMatch[1];
      const referenceKey = rawImageMatch[3] || rawImageMatch[1];
      const { src, fallbackSrc } = resolveImageSource({
        explicitSrc: rawImageMatch[2],
        referenceKey,
        references,
        post,
      });

      if (src) {
        fragment.append(createImage(alt, src, fallbackSrc));
      }

      index += 1;
      continue;
    }

    if (
      /^\|.+\|$/.test(line) &&
      index + 1 < lines.length &&
      /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(
        normalizeLine(lines[index + 1]),
      )
    ) {
      const tableRows = [lines[index], lines[index + 1]];
      index += 2;

      while (index < lines.length && /^\|.+\|$/.test(normalizeLine(lines[index]))) {
        tableRows.push(lines[index]);
        index += 1;
      }

      fragment.append(createTable(tableRows));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];

      while (index < lines.length && /^>\s?/.test(normalizeLine(lines[index]))) {
        quoteLines.push(trimMarkdownLine(lines[index]).replace(/^>\s?/, ""));
        index += 1;
      }

      fragment.append(createQuote(quoteLines.join(" ")));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const result = collectListItems(lines, index, /^[-*]\s+(.+)/, (match) => ({
        text: match[1],
      }));

      const { items } = result;
      index = result.index;
      fragment.append(createList(items));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const result = collectListItems(
        lines,
        index,
        /^(\d+)\.\s+(.+)/,
        (match) => ({
          value: Number.parseInt(match[1], 10),
          text: match[2],
        }),
      );

      const { items } = result;
      index = result.index;
      fragment.append(createList(items, true));
      continue;
    }

    const paragraphLines = [];

    while (
      index < lines.length &&
      normalizeLine(lines[index]).trim() &&
      !isBlockStart(normalizeLine(lines[index])) &&
      !getBlockMathDelimiter(lines[index])
    ) {
      paragraphLines.push(trimMarkdownLine(lines[index]).trim());
      index += 1;
    }

    fragment.append(createParagraph(paragraphLines.join(" ")));
  }

  return fragment;
};

const buildTableOfContents = (articleRoot) => {
  const tocNav = document.querySelector("#article-toc");
  const tocScroll = tocNav?.querySelector(".toc-scroll");

  if (!tocNav || !tocScroll) {
    return;
  }

  const headings = articleRoot.querySelectorAll(
    ".blog-body h2, .blog-body h3, .blog-body h4, .blog-body h5, .blog-body h6",
  );

  if (headings.length === 0) {
    tocNav.hidden = true;
    return;
  }

  const rootList = document.createElement("ul");
  rootList.className = "toc-list";
  const stack = [{ level: 0, list: rootList }];

  headings.forEach((heading) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const listItem = document.createElement("li");
    listItem.className = `toc-item toc-level-${level}`;

    const link = document.createElement("a");
    link.className = "toc-link";
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent;
    listItem.append(link);

    while (stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    stack[stack.length - 1].list.append(listItem);

    const sublist = document.createElement("ul");
    sublist.className = "toc-sublist";
    listItem.append(sublist);
    stack.push({ level, list: sublist });
  });

  rootList.querySelectorAll(".toc-sublist:empty").forEach((list) => list.remove());
  tocScroll.append(rootList);
  tocNav.hidden = false;

  const tocLinks = tocScroll.querySelectorAll(".toc-link");

  const setActiveLink = (id) => {
    tocLinks.forEach((tocLink) => {
      tocLink.classList.toggle(
        "is-active",
        tocLink.getAttribute("href") === `#${id}`,
      );
    });
  };

  tocLinks.forEach((tocLink) => {
    tocLink.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = tocLink.getAttribute("href").slice(1);
      const target = document.getElementById(targetId);

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", `#${targetId}`);
        setActiveLink(target.id);
      }
    });
  });

  if ("IntersectionObserver" in window) {
    const visibleHeadings = new Map();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleHeadings.set(entry.target.id, entry.intersectionRatio);
          } else {
            visibleHeadings.delete(entry.target.id);
          }
        });

        if (visibleHeadings.size === 0) {
          return;
        }

        const activeId = [...visibleHeadings.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0][0];
        setActiveLink(activeId);
      },
      {
        rootMargin: "-20% 0px -70% 0px",
        threshold: [0, 0.25, 0.5, 1],
      },
    );

    headings.forEach((heading) => observer.observe(heading));
  }

  if (window.location.hash) {
    const id = decodeURIComponent(window.location.hash.slice(1));

    if (document.getElementById(id)) {
      setActiveLink(id);
    }
  }
};

const renderArticlePage = () => {
  const postRoot = document.querySelector("#post");
  const template = document.querySelector("#article-template");

  if (!postRoot || !template) {
    return;
  }

  const selectedId = getRequestedPostId();
  const post = posts.find((candidate) => getPostId(candidate) === selectedId);

  if (!post) {
    postRoot.innerHTML = '<p class="empty-state">Post not found.</p>';
    return;
  }

  document.title = `${post.title} / JW Labs`;

  const { authors, abstractMarkdown, bodyMarkdown } = preprocessPostMarkdown(
    post.markdown,
    post,
  );
  const headingIds = new Set();
  const postNode = template.content.cloneNode(true);

  postNode.querySelector(".blog-title").textContent = post.title;
  postNode.querySelector(".blog-header").append(createShareButton(post));

  const metadata = postNode.querySelector(".blogmetadata");
  const dateNode = postNode.querySelector(".blog-date");
  const authorNode = postNode.querySelector(".blog-author");

  dateNode.textContent = formatBlogDate(post.date);

  if (authors) {
    appendAuthorsWithLinks(authorNode, authors);
    metadata.hidden = false;
  } else {
    authorNode.remove();
    metadata.hidden = false;
  }

  metadata.after(createAskAiBar(post));

  const abstractNode = postNode.querySelector("#abstract");

  if (abstractMarkdown) {
    abstractNode.hidden = false;
    abstractNode.append(renderMarkdown(abstractMarkdown, post, headingIds));
  } else {
    abstractNode.remove();
  }

  postNode
    .querySelector(".blog-body")
    .append(renderMarkdown(bodyMarkdown, post, headingIds));
  postRoot.append(postNode);
  buildTableOfContents(postRoot);
  ensureMathStylesheet();
  renderMathInPost(postRoot);
  highlightCodeInPost(postRoot);
};

const highlightCodeInPost = (root) => {
  const codeBlocks = root.querySelectorAll("pre code[data-language]");

  if (codeBlocks.length === 0) {
    return;
  }

  // highlight.js is deferred, so it may not be ready yet on first paint.
  const run = () => {
    if (typeof window.hljs?.highlightElement !== "function") {
      return false;
    }

    codeBlocks.forEach((block) => window.hljs.highlightElement(block));
    return true;
  };

  if (!run()) {
    window.addEventListener("load", run, { once: true });
  }
};

// Browsers (Safari especially) can keep a truncated or stale copy of a
// cached stylesheet indefinitely, which leaves KaTeX's layout rules missing
// while its @font-face rules still work - equations then render as collapsed,
// clipped glyph piles. Probe a rule from late in katex.min.css and refetch
// the stylesheet past the cache once if it isn't in effect.
const ensureMathStylesheet = () => {
  const probe = document.createElement("span");
  probe.className = "katex-display";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const applied = getComputedStyle(probe).display === "block";
  probe.remove();

  if (applied) {
    return;
  }

  const link = document.querySelector('link[href*="katex.min.css"]');

  if (link && !link.href.includes("cachebust")) {
    link.href = `${link.href}&cachebust=${Date.now()}`;
  }
};

// Math blocks default to overflow-x: clip because Safari mispaints KaTeX
// inside scroll containers at non-100% page zoom. Only equations wider than
// their container actually need scrolling, so opt just those into a scroll
// container, and keep the set current as the window resizes.
const updateMathScrollability = (root) => {
  root.querySelectorAll(".math-block").forEach((block) => {
    const inner = block.querySelector(".katex");

    if (!inner) {
      return;
    }

    block.classList.toggle(
      "is-scrollable",
      inner.getBoundingClientRect().width > block.clientWidth + 1,
    );
  });
};

const watchMathScrollability = (root) => {
  updateMathScrollability(root);

  let resizeTimer = null;

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => updateMathScrollability(root), 150);
  });
};

const renderMathInPost = (root) => {
  // KaTeX scripts are deferred, so retry on load if they haven't run yet.
  const run = () => {
    if (typeof window.renderMathInElement !== "function") {
      return false;
    }

    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      // HTML-only output: the default htmlAndMathml mode emits a hidden
      // MathML copy of every equation that becomes visible and overlaps the
      // page whenever the KaTeX stylesheet fails to (fully) load.
      output: "html",
      throwOnError: false,
    });
    watchMathScrollability(root);
    return true;
  };

  if (!run()) {
    window.addEventListener("load", run, { once: true });
  }
};

// Temporary in-page diagnostics: open any post with ?mathdebug=1 to overlay
// the computed styles that govern KaTeX layout. Lets us inspect a reader's
// exact browser state (extensions, cached CSS) without devtools access.
const renderMathDebugOverlay = () => {
  if (!new URLSearchParams(window.location.search).has("mathdebug")) {
    return;
  }

  const fixes = {
    1: ".katex .vlist-t { border-collapse: separate !important; }",
    2: ".blog-content .katex { transform: translateZ(0); }",
    3: ".blog-content .math-block { line-height: normal; }",
    4: ".katex .vlist-t { display: inline-flex !important; align-items: baseline; }",
    5: ".blog-content .katex-display > .katex { transform: translateZ(0); }",
  };
  const fixId = new URLSearchParams(window.location.search).get("mathfix");

  if (fixes[fixId]) {
    const style = document.createElement("style");
    style.textContent = fixes[fixId];
    document.head.append(style);
  }

  const lines = [];
  lines.push(`ua: ${navigator.userAgent}  fix=${fixId ?? "none"}`);
  lines.push(`dpr=${window.devicePixelRatio} innerW=${window.innerWidth} outerW=${window.outerWidth} vvScale=${window.visualViewport?.scale}`);
  lines.push(`render-blog: ${document.querySelector('script[src*="render-blog"]')?.src}`);
  lines.push(`katex css: ${document.querySelector('link[href*="katex.min.css"]')?.href}`);
  lines.push(`katex js loaded: ${typeof window.katex} / autorender: ${typeof window.renderMathInElement}`);
  lines.push(`katex nodes: ${document.querySelectorAll(".katex").length}, mathml nodes: ${document.querySelectorAll(".katex-mathml").length}`);

  const probeClass = (cls, props) => {
    const el = document.querySelector(cls);
    if (!el) {
      lines.push(`${cls}: MISSING`);
      return;
    }
    const cs = getComputedStyle(el);
    lines.push(`${cls}: ${props.map((p) => `${p}=${cs[p]}`).join(" ")}`);
  };

  probeClass(".katex", ["fontFamily", "fontSize", "lineHeight"]);
  probeClass(".katex-display", ["display", "overflow", "textAlign"]);
  probeClass(".katex .vlist-t", ["display", "tableLayout", "borderCollapse"]);
  probeClass(".katex .vlist-r", ["display"]);
  probeClass(".katex .vlist", ["display", "position", "overflow"]);
  probeClass(".katex .vlist > span", ["display", "position", "height", "overflow"]);
  probeClass(".katex .pstrut", ["display", "overflow"]);
  probeClass(".katex .op-symbol", ["fontFamily", "position", "top", "display"]);
  probeClass(".math-block", ["overflow", "overflowX", "overflowY", "lineHeight"]);

  const large = document.querySelector(".katex .op-symbol.large-op");
  if (large) {
    const r = large.getBoundingClientRect();
    lines.push(`large-op rect: ${Math.round(r.width)}x${Math.round(r.height)} font=${getComputedStyle(large).fontFamily}`);
  }

  lines.push(`fonts: Size2=${document.fonts.check('20px "KaTeX_Size2"', "∑")} Size1=${document.fonts.check('20px "KaTeX_Size1"', "∑")} Main=${document.fonts.check('20px "KaTeX_Main"', "x")}`);

  const overlay = document.createElement("pre");
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff;color:#000;" +
    "font:11px/1.5 Menlo,monospace;padding:10px;border-bottom:2px solid #c00;" +
    "white-space:pre-wrap;margin:0;max-height:60vh;overflow:auto;";
  overlay.textContent = lines.join("\n");
  document.body.append(overlay);
};

renderArticlePage();
window.addEventListener("load", () => setTimeout(renderMathDebugOverlay, 500));
