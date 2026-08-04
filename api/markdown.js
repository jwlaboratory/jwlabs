// Plain-text endpoint that returns a post's raw markdown.
//
// Articles render client-side, so a normal fetch of /post/<slug> returns an
// empty shell. This endpoint returns the actual article text as text/plain so
// any AI (or curl) can read it directly, no JavaScript required.

const fs = require("fs");
const path = require("path");

let cachedPosts = null;

const loadPosts = () => {
  if (cachedPosts) {
    return cachedPosts;
  }

  // blogs.js is a browser script that assigns window.BLOG_POSTS. Run it with a
  // stubbed window to pull the data out in Node.
  const code = fs.readFileSync(
    path.join(process.cwd(), "content", "blogs.js"),
    "utf8",
  );
  const sandboxWindow = {};
  new Function("window", code)(sandboxWindow);
  cachedPosts = sandboxWindow.BLOG_POSTS ?? [];
  return cachedPosts;
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPostId = (post) => post.slug ?? slugify(post.title);

module.exports = (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let id = url.searchParams.get("id");

  if (!id) {
    const pathMatch = url.pathname.match(/\/markdown\/([^/]+)/);
    id = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");

  const post = loadPosts().find((candidate) => getPostId(candidate) === id);

  if (!post) {
    res.statusCode = 404;
    res.end("Post not found");
    return;
  }

  res.statusCode = 200;
  res.end(post.markdown);
};
