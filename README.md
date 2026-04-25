# jwlabs

An extremely minimal static research blog.

The root page, `index.html`, is only the list of blog posts. Each title links to
`post.html`, which renders the full article.

## Add Blog Posts

Edit `content/blogs.js`.

Each post has this shape:

```js
{
  slug: "post-url-id",
  title: "Post title",
  date: "2026-04-24",
  category: "Research",
  summary: "One or two sentence summary.",
  markdown: markdown(() => { /*
# Section heading

Paste Markdown here.

- Lists work
- **Bold**, *italic*, `inline code`, and [links](https://example.com) work

```js
console.log("code blocks work");
```
*/ })
}
```

To write a new post:

1. Copy the object in `content/blogs.js`.
2. Change `slug`, `title`, `date`, `category`, and `summary`.
3. Paste your post between `/*` and `*/` in the `markdown` field.

Supported Markdown:

- Headings: `#` through `######`
- Bullet lists and numbered lists
- Blockquotes with `>`
- Inline links, bold, italics, and inline code
- Fenced code blocks
- Markdown tables
- Images, including reference-style images like `![][image1]`

## Images

For a post with `slug: "post-url-id"`, put image files in:

```text
content/post-url-id/image1.png
content/post-url-id/image2.png
```

Reference-style Markdown like `![][image1]` will automatically use
`content/post-url-id/image1.png`. If that file is missing, the renderer falls
back to the embedded image reference in the Markdown.

## Preview

Open `index.html` in a browser, or serve the folder with any static file server.
