// Server-side prerenderer. Runs the site's real client renderers
// (scripts/render-blog.js etc.) against a linkedom DOM so the prerendered
// HTML is produced by the same code browsers run — no second markdown
// implementation to keep in sync. Used by build.js at deploy time and by
// api/post.js as the dynamic fallback for slugs missing from the static build.
//
// Math is intentionally left as raw TeX ($...$): KaTeX still runs in the
// browser, and crawlers index the TeX source as text.

const fs = require("fs");
const path = require("path");

// linkedom's CommonJS build is broken against css-select v7 (ESM-only), so
// load the ESM build via dynamic import; this makes the renderers async.
const parseHTML = async (html) => (await import("linkedom")).parseHTML(html);

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://jwlabs.vercel.app";

const projectRoot = path.join(__dirname, "..");

const readSource = (relativePath) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

// content/*.js are browser scripts that assign onto window; run them with a
// stub window to pull the data out in Node (same trick as api/markdown.js).
const loadWindowData = () => {
  const data = {};

  ["content/authors.js", "content/blogs.js", "content/site.js"].forEach(
    (script) => new Function("window", readSource(script))(data),
  );

  return data;
};

let cachedData = null;

const getSiteData = () => {
  cachedData = cachedData ?? loadWindowData();
  return cachedData;
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPostId = (post) => post.slug ?? slugify(post.title);

// Runs one of the site's client scripts against a linkedom document. The
// window stub is a plain object: `"IntersectionObserver" in window` is false,
// timers/listeners registered on it go nowhere, and getComputedStyle reports
// the KaTeX stylesheet as applied so ensureMathStylesheet doesn't cache-bust
// the <link> href into the serialized HTML. queueMicrotask is a no-op because
// linkedom video elements have no play().
const runClientScript = (scriptPath, document, windowStub) => {
  new Function(
    "window",
    "document",
    "navigator",
    "history",
    "getComputedStyle",
    "queueMicrotask",
    readSource(scriptPath),
  )(windowStub, document, {}, {}, () => ({ display: "block" }), () => {});
};

const setHeadTag = (document, selector, create, mutate) => {
  let tag = document.head.querySelector(selector);

  if (!tag) {
    tag = create();
    document.head.appendChild(tag);
  }

  mutate(tag);
};

const setMeta = (document, attribute, name, content) =>
  setHeadTag(
    document,
    `meta[${attribute}="${name}"]`,
    () => {
      const tag = document.createElement("meta");
      tag.setAttribute(attribute, name);
      return tag;
    },
    (tag) => tag.setAttribute("content", content),
  );

const setCanonical = (document, url) =>
  setHeadTag(
    document,
    'link[rel="canonical"]',
    () => {
      const tag = document.createElement("link");
      tag.setAttribute("rel", "canonical");
      return tag;
    },
    (tag) => tag.setAttribute("href", url),
  );

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i;

// Configured share image, or the first raster image referenced in the post.
const findShareImage = (post) => {
  if (post.shareImage && IMAGE_EXTENSION_PATTERN.test(post.shareImage)) {
    return post.shareImage.startsWith("/")
      ? `${SITE_ORIGIN}${post.shareImage}`
      : post.shareImage;
  }

  const imagePattern = /!\[[^\]]*\](?:\(([^)\s]+)[^)]*\)|\[([^\]]*)\])/g;
  let match;

  while ((match = imagePattern.exec(post.markdown ?? "")) !== null) {
    const src = match[1] ?? `/content/${getPostId(post)}/${match[2]}.png`;

    if (IMAGE_EXTENSION_PATTERN.test(src)) {
      return src.startsWith("/") ? `${SITE_ORIGIN}${src}` : src;
    }
  }

  return null;
};

const describePost = (post) => {
  const summary = (post.summary ?? "").trim().replace(/\s+/g, " ");

  if (!summary) {
    return "JW Labs research post.";
  }

  return summary.length > 300 ? `${summary.slice(0, 297).trimEnd()}...` : summary;
};

const renderPostPage = async (post) => {
  const data = getSiteData();
  const id = getPostId(post);
  const { document } = await parseHTML(readSource("post.html"));

  const windowStub = {
    BLOG_POSTS: data.BLOG_POSTS ?? [],
    AUTHORS: data.AUTHORS ?? [],
    location: {
      search: "",
      pathname: `/post/${encodeURIComponent(id)}`,
      origin: SITE_ORIGIN,
      hash: "",
    },
    addEventListener: () => {},
  };

  runClientScript("scripts/render-blog.js", document, windowStub);

  const title = `${post.title} / JW Labs`;
  const description = describePost(post);
  const url = `${SITE_ORIGIN}/post/${encodeURIComponent(id)}`;
  const image = findShareImage(post);

  document.title = title;
  setMeta(document, "name", "description", description);
  setMeta(document, "property", "og:title", post.title);
  setMeta(document, "property", "og:description", description);
  setMeta(document, "property", "og:url", url);
  setMeta(document, "property", "article:published_time", post.date);
  setMeta(document, "name", "twitter:title", post.title);
  setMeta(document, "name", "twitter:description", description);
  setCanonical(document, url);

  if (image) {
    setMeta(document, "property", "og:image", image);
    setMeta(document, "name", "twitter:image", image);
    setMeta(document, "name", "twitter:card", "summary_large_image");
  }

  return serialize(document);
};

const renderIndexPage = async () => {
  const data = getSiteData();
  const { document } = await parseHTML(readSource("index.html"));

  runClientScript("scripts/render-research.js", document, {
    BLOG_POSTS: data.BLOG_POSTS ?? [],
    SITE_CONTENT: data.SITE_CONTENT ?? {},
  });

  setCanonical(document, `${SITE_ORIGIN}/`);
  return serialize(document);
};

const renderTeamPage = async () => {
  const data = getSiteData();
  const { document } = await parseHTML(readSource("team.html"));

  runClientScript("scripts/render-team.js", document, {
    AUTHORS: data.AUTHORS ?? [],
  });

  setCanonical(document, `${SITE_ORIGIN}/team.html`);
  return serialize(document);
};

const serialize = (document) => {
  const html = document.toString();
  return html.startsWith("<!") ? html : `<!doctype html>\n${html}`;
};

module.exports = {
  SITE_ORIGIN,
  getSiteData,
  getPostId,
  renderPostPage,
  renderIndexPage,
  renderTeamPage,
};
