const posts = window.BLOG_POSTS ?? [];
const siteContent = window.SITE_CONTENT ?? {};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPostId = (post) => post.slug ?? slugify(post.title);

const formatShortDate = (dateValue) => {
  const date = new Date(`${dateValue}T00:00:00`);

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

const createListItem = ({ title, date, href }) => {
  const dateEl = document.createElement("span");
  dateEl.className = "list-item-date";
  dateEl.textContent = formatShortDate(date);

  const titleEl = document.createElement("span");
  titleEl.className = "list-item-title";
  titleEl.textContent = title;

  if (href) {
    const link = document.createElement("a");
    link.className = "list-item list-item-link";
    link.href = href;
    link.append(titleEl, dateEl);
    return link;
  }

  const item = document.createElement("article");
  item.className = "list-item";
  item.append(titleEl, dateEl);
  return item;
};

const renderSection = (sectionId, listId, items) => {
  const section = document.querySelector(`#${sectionId}`);
  const list = document.querySelector(`#${listId}`);

  if (!section || !list) {
    return;
  }

  if (items.length === 0) {
    section.hidden = true;
    return;
  }

  items.forEach((item) => list.append(createListItem(item)));
};

const renderResearchPage = () => {
  const announcements = (siteContent.announcements ?? []).map((item) => ({
    ...item,
    href: item.href ?? null,
  }));

  const visiblePosts = [...posts]
    .filter((post) => !post.hidden)
    .sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`))
    .map((post) => ({
      title: post.title,
      date: post.date,
      category: post.category,
      href: `./post.html?id=${encodeURIComponent(getPostId(post))}`,
    }));

  const researchPosts = visiblePosts.filter((post) => post.category !== "Engineering");

  const engineering = [
    ...(siteContent.engineering ?? []).map((item) => ({
      ...item,
      href: item.href ?? null,
    })),
    ...visiblePosts.filter((post) => post.category === "Engineering"),
  ];

  renderSection("announcements-section", "announcements-list", announcements);
  renderSection("research-section", "research-list", researchPosts);
  renderSection("engineering-section", "engineering-list", engineering);
};

renderResearchPage();
