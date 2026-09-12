// Dynamic fallback for /post/<slug>. Post pages are prerendered to static
// files at deploy (see build.js), and Vercel serves those before rewrites run,
// so this only handles slugs missing from the static build. It renders the
// same prerendered HTML on demand; unknown slugs get the client shell with a
// 404 status so the browser shows "Post not found."

const fs = require("fs");
const path = require("path");
const { getSiteData, getPostId, renderPostPage } = require("../lib/prerender");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let id = url.searchParams.get("id");

  if (!id) {
    const pathMatch = url.pathname.match(/\/post\/([^/]+)/);
    id = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const post = (getSiteData().BLOG_POSTS ?? []).find(
    (candidate) => getPostId(candidate) === id,
  );

  if (!post) {
    res.statusCode = 404;
    res.end(fs.readFileSync(path.join(process.cwd(), "post.html"), "utf8"));
    return;
  }

  res.statusCode = 200;
  res.end(await renderPostPage(post));
};
