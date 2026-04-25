const posts = window.BLOG_POSTS ?? [];

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPostId = (post) => post.slug ?? slugify(post.title);

const formatDate = (dateValue) => {
  const date = new Date(`${dateValue}T00:00:00`);

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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
    const listItem = document.createElement("li");
    appendInlineMarkdown(listItem, item);
    list.append(listItem);
  });

  return list;
};

const createQuote = (text) => {
  const quote = document.createElement("blockquote");
  appendInlineMarkdown(quote, text);
  return quote;
};

const createHeading = (level, text) => {
  const heading = document.createElement(`h${Math.min(level + 1, 6)}`);
  appendInlineMarkdown(heading, text);
  return heading;
};

const createCodeBlock = (lines, language = "") => {
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  if (language) {
    code.dataset.language = language;
  }

  code.textContent = lines.join("\n");
  pre.append(code);

  return pre;
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

const createImage = (alt, src, fallbackSrc = "") => {
  const figure = document.createElement("figure");
  const image = document.createElement("img");

  image.alt = alt;
  image.loading = "lazy";
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
  const localSrc = `./content/${getPostId(post)}/${referenceKey}.png`;

  return {
    src: localSrc,
    fallbackSrc,
  };
};

const createTable = (rows) => {
  const table = document.createElement("table");
  const [headerRow, , ...bodyRows] = rows;
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const splitRow = (row) =>
    normalizeLine(row)
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());

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
      appendInlineMarkdown(td, cell);
      tr.append(td);
    });

    tbody.append(tr);
  });

  table.append(thead, tbody);
  return table;
};

const isBlockStart = (line) =>
  /^#{1,6}\s+/.test(line) ||
  /^>\s?/.test(line) ||
  /^[-*]\s+/.test(line) ||
  /^\d+\.\s+/.test(line) ||
  /^!\[.*\]/.test(line) ||
  /^\|.+\|$/.test(line) ||
  /^```/.test(line);

const renderMarkdown = (markdown = "", post = {}) => {
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
      fragment.append(createHeading(headingMatch[1].length, headingMatch[2]));
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
      const items = [];

      while (
        index < lines.length &&
        /^[-*]\s+/.test(normalizeLine(lines[index]))
      ) {
        items.push(normalizeLine(lines[index]).replace(/^[-*]\s+/, ""));
        index += 1;
      }

      fragment.append(createList(items));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];

      while (
        index < lines.length &&
        /^\d+\.\s+/.test(normalizeLine(lines[index]))
      ) {
        items.push(normalizeLine(lines[index]).replace(/^\d+\.\s+/, ""));
        index += 1;
      }

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

const renderListPage = () => {
  const postsRoot = document.querySelector("#posts");
  const template = document.querySelector("#post-template");

  if (!postsRoot || !template) {
    return;
  }

  if (posts.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "No posts yet.";
    postsRoot.append(emptyState);
    return;
  }

  posts.forEach((post) => {
    const postNode = template.content.cloneNode(true);
    const link = postNode.querySelector(".post-title-link");

    postNode.querySelector("time").dateTime = post.date;
    postNode.querySelector("time").textContent = formatDate(post.date);
    postNode.querySelector(".category").textContent = post.category;
    postNode.querySelector(".summary").textContent = post.summary;
    link.href = `./post.html?id=${encodeURIComponent(getPostId(post))}`;
    link.textContent = post.title;

    postsRoot.append(postNode);
  });
};

const renderArticlePage = () => {
  const postRoot = document.querySelector("#post");
  const template = document.querySelector("#article-template");

  if (!postRoot || !template) {
    return;
  }

  const selectedId = new URLSearchParams(window.location.search).get("id");
  const post = posts.find((candidate) => getPostId(candidate) === selectedId);

  if (!post) {
    postRoot.innerHTML = '<p class="empty-state">Post not found.</p>';
    return;
  }

  document.title = `${post.title} / JW Labs`;

  const postNode = template.content.cloneNode(true);
  postNode.querySelector(".post-body").append(renderMarkdown(post.markdown, post));
  postRoot.append(postNode);
};

renderListPage();
renderArticlePage();
