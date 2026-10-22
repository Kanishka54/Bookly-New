const Book = require("../models/Book");

const PAGE_SIZE = 12;

function parsePage(value) {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return 1;
  }
  const raw = String(value).trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    return 1;
  }
  const page = Number(raw);
  if (!Number.isSafeInteger(page)) {
    return 1;
  }
  return page;
}

function firstQueryValue(value) {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildBookFilter({ q, category }) {
  const filter = {};
  const query = firstQueryValue(q);
  const selectedCategory = firstQueryValue(category);

  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { title: { $regex: escaped, $options: "i" } },
      { author: { $regex: escaped, $options: "i" } },
    ];
  }

  if (selectedCategory) {
    filter.category = selectedCategory;
  }

  return filter;
}

function pageHref(pathname, preserved, pageNum) {
  const params = new URLSearchParams();
  if (preserved.q) {
    params.set("q", preserved.q);
  }
  if (preserved.category) {
    params.set("category", preserved.category);
  }
  params.set("page", String(pageNum));
  return `${pathname}?${params.toString()}`;
}

async function paginateBooks({ q, category, page, pathname }) {
  const requestedPage = parsePage(page);
  const preserved = {
    q: firstQueryValue(q),
    category: firstQueryValue(category),
  };
  const filter = buildBookFilter(preserved);
  const total = await Book.countDocuments(filter);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage =
    total === 0 ? 1 : Math.min(requestedPage, totalPages);

  const books = await Book.find(filter)
    .sort({ _id: -1 })
    .skip((currentPage - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE);

  const pages = [];
  for (let number = 1; number <= totalPages; number += 1) {
    pages.push({
      number,
      href: pageHref(pathname, preserved, number),
      current: number === currentPage,
    });
  }

  return {
    books,
    page: currentPage,
    totalPages,
    total,
    q: preserved.q,
    category: preserved.category,
    pages,
    prevHref:
      currentPage > 1 ? pageHref(pathname, preserved, currentPage - 1) : null,
    nextHref:
      totalPages > 0 && currentPage < totalPages
        ? pageHref(pathname, preserved, currentPage + 1)
        : null,
  };
}

module.exports = {
  PAGE_SIZE,
  parsePage,
  buildBookFilter,
  paginateBooks,
};
