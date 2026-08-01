const authors = window.AUTHORS ?? [];

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const createContactLink = (label, href) => {
  const link = document.createElement("a");
  link.className = "team-contact-link";
  link.href = href;
  link.textContent = label;

  if (!href.startsWith("mailto:")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  return link;
};

const createAuthorRow = (author) => {
  const row = document.createElement("div");
  row.className = "team-member";
  row.id = slugify(author.name);

  const nameEl = document.createElement("span");
  nameEl.className = "team-member-name";
  nameEl.textContent = author.name;
  row.append(nameEl);

  const links = document.createElement("div");
  links.className = "team-contact-links";

  if (author.email) {
    links.append(createContactLink("Email", `mailto:${author.email}`));
  }

  if (author.x) {
    links.append(createContactLink("X", `https://x.com/${author.x}`));
  }

  if (author.github) {
    links.append(createContactLink("GitHub", `https://github.com/${author.github}`));
  }

  row.append(links);
  return row;
};

const renderTeamPage = () => {
  const list = document.querySelector("#team-list");

  if (!list) {
    return;
  }

  if (authors.length === 0) {
    list.innerHTML = '<p class="empty-state">No team members yet.</p>';
    return;
  }

  authors.forEach((author) => list.append(createAuthorRow(author)));
};

renderTeamPage();
