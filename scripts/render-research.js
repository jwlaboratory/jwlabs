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

const createListItem = ({ title, date, href, className = "" }) => {
  const dateEl = document.createElement("span");
  dateEl.className = "list-item-date";
  dateEl.textContent = formatShortDate(date);

  const titleEl = document.createElement("span");
  titleEl.className = "list-item-title";
  titleEl.textContent = title;

  if (href) {
    const link = document.createElement("a");
    link.className = `list-item list-item-link ${className}`.trim();
    link.href = href;
    link.append(titleEl, dateEl);
    return link;
  }

  const item = document.createElement("article");
  item.className = `list-item ${className}`.trim();
  item.append(titleEl, dateEl);
  return item;
};

const createSeriesGroup = ({ title, posts: seriesPosts }) => {
  const group = document.createElement("div");
  group.className = "list-series";

  const seriesTitle = document.createElement("div");
  seriesTitle.className = "list-series-title";
  seriesTitle.textContent = title;
  group.append(seriesTitle);

  const children = document.createElement("div");
  children.className = "list-series-children";

  seriesPosts.forEach((post) => {
    children.append(
      createListItem({
        ...post,
        title: post.homeTitle ?? post.title,
        className: "list-series-child",
      }),
    );
  });

  group.append(children);
  return group;
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

  // The page may arrive prerendered (see build.js); rebuild the list fresh.
  list.replaceChildren();
  items.forEach((item) => {
    if (item.type === "series") {
      list.append(createSeriesGroup(item));
    } else {
      list.append(createListItem(item));
    }
  });
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
      series: post.series,
      seriesTitle: post.seriesTitle,
      seriesPart: post.seriesPart,
      homeTitle: post.homeTitle,
      href: `/post/${encodeURIComponent(getPostId(post))}`,
    }));

  const researchPosts = visiblePosts.filter(
    (post) => post.category !== "Engineering" && post.category !== "Side Quests",
  );

  const engineeringPosts = visiblePosts.filter(
    (post) => post.category === "Engineering" && !post.series,
  );
  const seriesGroups = [...new Set(
    visiblePosts
      .filter((post) => post.category === "Engineering" && post.series)
      .map((post) => post.series),
  )].map((series) => {
    const seriesPosts = visiblePosts
      .filter((post) => post.category === "Engineering" && post.series === series)
      .sort((a, b) => (a.seriesPart ?? 0) - (b.seriesPart ?? 0));

    return {
      type: "series",
      title: seriesPosts[0]?.seriesTitle ?? series,
      posts: seriesPosts,
    };
  });

  const engineering = [
    ...(siteContent.engineering ?? []).map((item) => ({
      ...item,
      href: item.href ?? null,
    })),
    ...seriesGroups,
    ...engineeringPosts,
  ];

  const sideQuests = visiblePosts.filter((post) => post.category === "Side Quests");

  renderSection("announcements-section", "announcements-list", announcements);
  renderSection("research-section", "research-list", researchPosts);
  renderSection("engineering-section", "engineering-list", engineering);
  renderSection("side-quests-section", "side-quests-list", sideQuests);
};

renderResearchPage();
