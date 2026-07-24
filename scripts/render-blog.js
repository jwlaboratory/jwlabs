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

const appendInlineMarkdown = (root, text) => {
  const cleanText = unescapeMarkdownSyntax(text);
  const inlinePattern =
    /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = inlinePattern.exec(cleanText)) !== null) {
    root.append(document.createTextNode(cleanText.slice(lastIndex, match.index)));

    if (match[2] && match[3]) {
      const link = document.createElement("a");
      link.href = match[3];
      link.textContent = match[2];
      root.append(link);
    } else if (match[4]) {
      const code = document.createElement("code");
      code.textContent = match[4];
      root.append(code);
    } else if (match[5]) {
      const strong = document.createElement("strong");
      strong.textContent = match[5];
      root.append(strong);
    } else if (match[6]) {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[6];
      root.append(emphasis);
    }

    lastIndex = inlinePattern.lastIndex;
  }

  root.append(document.createTextNode(cleanText.slice(lastIndex)));
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
    normalizeLine(row)
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
    const match = line.match(itemPattern);

    if (match) {
      items.push(createItem(match));
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
      fragment.append(
        createHeading(headingMatch[1].length, headingMatch[2], usedHeadingIds),
      );
      index += 1;
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\](?:\(([^)]+)\)|\[([^\]]*)\])$/);
    if (imageMatch) {
      const alt = imageMatch[1];
      const referenceKey = imageMatch[3] || imageMatch[1];
      const { src, fallbackSrc } = resolveImageSource({
        explicitSrc: imageMatch[2],
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
        quoteLines.push(normalizeLine(lines[index]).replace(/^>\s?/, ""));
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
      !isBlockStart(normalizeLine(lines[index]))
    ) {
      paragraphLines.push(normalizeLine(lines[index]).trim());
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

  const metadata = postNode.querySelector(".blogmetadata");
  const dateNode = postNode.querySelector(".blog-date");
  const authorNode = postNode.querySelector(".blog-author");

  dateNode.textContent = formatBlogDate(post.date);

  if (authors) {
    authorNode.textContent = authors;
    metadata.hidden = false;
  } else {
    authorNode.remove();
    metadata.hidden = false;
  }

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
  renderMathInPost(postRoot);
};

const renderMathInPost = (root) => {
  if (typeof window.renderMathInElement !== "function") {
    return;
  }

  window.renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
};

renderArticlePage();
