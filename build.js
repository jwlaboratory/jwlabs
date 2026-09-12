// Deploy-time build: copies the static site into dist/ and prerenders the
// homepage, team page, and every post page (see lib/prerender.js), so crawlers,
// link-preview scrapers, and no-JS fetchers get real content and per-post meta
// tags instead of an empty shell. Also emits sitemap.xml and robots.txt.
// Browsers still re-render client-side; prerendered markup is the fallback.

const fs = require("fs");
const path = require("path");
const {
  SITE_ORIGIN,
  getSiteData,
  getPostId,
  renderPostPage,
  renderIndexPage,
  renderTeamPage,
} = require("./lib/prerender");

const projectRoot = __dirname;
const dist = path.join(projectRoot, "dist");

const STATIC_ENTRIES = [
  "index.html",
  "post.html",
  "team.html",
  "styles.css",
  "content",
  "scripts",
  "vendor",
  "lab-notes",
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

STATIC_ENTRIES.forEach((entry) => {
  fs.cpSync(path.join(projectRoot, entry), path.join(dist, entry), {
    recursive: true,
    filter: (source) => path.basename(source) !== ".DS_Store",
  });
});

const writeOutput = (relativePath, contents) => {
  const target = path.join(dist, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};

const main = async () => {
  writeOutput("index.html", await renderIndexPage());
  writeOutput("team.html", await renderTeamPage());

  const posts = getSiteData().BLOG_POSTS ?? [];

  for (const post of posts) {
    writeOutput(
      path.join("post", getPostId(post), "index.html"),
      await renderPostPage(post),
    );
  }

  const visiblePosts = posts.filter((post) => !post.hidden);

  const sitemapEntries = [
    { loc: `${SITE_ORIGIN}/` },
    { loc: `${SITE_ORIGIN}/team.html` },
    ...visiblePosts.map((post) => ({
      loc: `${SITE_ORIGIN}/post/${encodeURIComponent(getPostId(post))}`,
      lastmod: post.date,
    })),
  ];

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries.map(({ loc, lastmod }) =>
      [
        "  <url>",
        `    <loc>${loc}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        "  </url>",
      ].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");

  writeOutput("sitemap.xml", sitemap);
  writeOutput(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );

  console.log(
    `Built ${posts.length} post pages (${visiblePosts.length} in sitemap) into ${path.relative(projectRoot, dist)}/`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
