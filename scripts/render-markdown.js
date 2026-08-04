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

  const pathMatch = window.location.pathname.match(/^\/markdown\/([^/]+)\/?$/);

  return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
};

const renderMarkdownPage = () => {
  const root = document.querySelector("#markdown-view");

  if (!root) {
    return;
  }

  const selectedId = getRequestedPostId();
  const post = posts.find((candidate) => getPostId(candidate) === selectedId);

  if (!post) {
    root.innerHTML = '<p class="empty-state">Post not found.</p>';
    return;
  }

  document.title = `${post.title} — Markdown / JW Labs`;

  const heading = document.createElement("h1");
  heading.className = "markdown-heading";
  heading.textContent = post.title;

  const subhead = document.createElement("p");
  subhead.className = "markdown-subhead";
  subhead.textContent = "Raw markdown — copy and paste into any AI to discuss this article.";

  const actions = document.createElement("div");
  actions.className = "markdown-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "markdown-copy";
  copyButton.textContent = "Copy markdown";

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(post.markdown);
      copyButton.textContent = "Copied!";
    } catch (error) {
      // Fallback: select the text so the user can copy manually.
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyButton.textContent = "Press Cmd/Ctrl+C";
    }

    window.setTimeout(() => {
      copyButton.textContent = "Copy markdown";
    }, 2000);
  });

  const backLink = document.createElement("a");
  backLink.className = "markdown-back";
  backLink.href = `/post/${encodeURIComponent(getPostId(post))}`;
  backLink.textContent = "← Back to article";

  actions.append(copyButton, backLink);

  const pre = document.createElement("pre");
  pre.className = "markdown-source";
  const code = document.createElement("code");
  code.textContent = post.markdown;
  pre.append(code);

  root.append(heading, subhead, actions, pre);
};

renderMarkdownPage();
