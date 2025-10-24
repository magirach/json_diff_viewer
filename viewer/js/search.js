// ===== Advanced Search with Navigation =====
const searchBox = document.getElementById("searchBox");
const searchBtn = document.getElementById("searchBtn");
const clearSearch = document.getElementById("clearSearch");
const resultsPanel = document.getElementById("searchResults");
const resultsList = document.getElementById("resultsList");
const resultCount = document.getElementById("resultCount");
const closeResults = document.getElementById("closeResults");
const nextResultBtn = document.getElementById("nextResult");
const prevResultBtn = document.getElementById("prevResult");

let matches = [];
let currentMatchIndex = -1;

if (searchBtn && searchBox && clearSearch) {
  searchBtn.addEventListener("click", handleSearch);
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
  clearSearch.addEventListener("click", clearSearchResults);
}
if (closeResults) closeResults.addEventListener("click", clearSearchResults);
if (nextResultBtn) nextResultBtn.addEventListener("click", nextMatch);
if (prevResultBtn) prevResultBtn.addEventListener("click", prevMatch);

function handleSearch() {
  const keyword = searchBox.value.trim().toLowerCase();
  clearHighlights();
  showAllNodes();
  resultsList.innerHTML = "";
  matches = [];
  currentMatchIndex = -1;

  if (!keyword) {
    hideResultsPanel();
    return;
  }

  const items = document.querySelectorAll(".json-item");
  items.forEach((item) => {
    const keyEl = item.querySelector(".json-key");
    const valEl = item.querySelector(".json-value");
    const keyText = keyEl ? keyEl.textContent.toLowerCase() : "";
    const valText = valEl ? valEl.textContent.toLowerCase() : "";
    const hasMatch = keyText.includes(keyword) || valText.includes(keyword);

    if (hasMatch) {
      highlightText(keyEl, keyword);
      highlightText(valEl, keyword);
      showFullObject(item);

      const path = getNodePath(item);
      matches.push({
        element: item,
        key: keyEl?.textContent || "(value)",
        value: valEl?.textContent || "",
        path,
      });
    }
  });

  if (matches.length > 0) {
    showResultsPanel();
    scrollToMatch(0);
  } else {
    hideResultsPanel();
  }
}

function showResultsPanel() {
  resultsPanel.classList.remove("hidden");
  resultCount.textContent = `(${matches.length} match${matches.length > 1 ? "es" : ""})`;

  resultsList.innerHTML = "";
  matches.forEach((match, idx) => {
    const li = document.createElement("li");
    const shortVal =
      match.value.length > 80 ? match.value.slice(0, 80) + "..." : match.value;
    li.innerHTML = `<strong>${match.key}</strong>: ${shortVal.replace(
      /</g,
      "&lt;"
    )}<br><span style="font-size:12px;color:#777">${match.path}</span>`;
    li.addEventListener("click", () => scrollToMatch(idx));
    resultsList.appendChild(li);
  });
}

function hideResultsPanel() {
  resultsPanel.classList.add("hidden");
  resultsList.innerHTML = "";
  resultCount.textContent = "(0 matches)";
}

function clearSearchResults() {
  searchBox.value = "";
  clearHighlights();
  showAllNodes();
  hideResultsPanel();
  matches = [];
  currentMatchIndex = -1;
}

function scrollToMatch(index) {
  if (matches.length === 0) return;

  currentMatchIndex = index;
  matches.forEach((m, i) => {
    const li = resultsList.children[i];
    li.classList.toggle("active", i === index);
  });

  const match = matches[index];
  showFullObject(match.element);
  match.element.scrollIntoView({ behavior: "smooth", block: "center" });
  match.element.style.transition = "background 0.3s";
  match.element.style.background = "#fff9c4";
  setTimeout(() => (match.element.style.background = ""), 800);
}

function nextMatch() {
  if (matches.length === 0) return;
  const nextIndex = (currentMatchIndex + 1) % matches.length;
  scrollToMatch(nextIndex);
}

function prevMatch() {
  if (matches.length === 0) return;
  const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
  scrollToMatch(prevIndex);
}

/* --- Utility Functions --- */
function highlightText(element, keyword) {
  if (!element || !element.textContent) return;
  const text = element.textContent;
  const regex = new RegExp(`(${escapeRegex(keyword)})`, "gi");
  element.innerHTML = text.replace(regex, `<span class="highlight">$1</span>`);
}

function showFullObject(element) {
  let parent = element;
  while (parent) {
    if (parent.classList.contains("json-item")) {
      parent.style.display = "";
      parent.dataset.show = "true";
    }
    const childContainer = parent.querySelector(".child-container");
    if (childContainer) childContainer.style.display = "";
    const toggle = parent.querySelector(".toggle");
    if (toggle && toggle.textContent.trim() === "+") toggle.click();
    parent = parent.parentElement;
  }
}

function clearHighlights() {
  document.querySelectorAll(".highlight").forEach((el) => (el.outerHTML = el.innerText));
}

function showAllNodes() {
  document.querySelectorAll(".json-item").forEach((item) => (item.style.display = ""));
}

function getNodePath(element) {
  const path = [];
  let node = element;
  while (node && node.closest(".json-item")) {
    const keyEl = node.querySelector(".json-key");
    if (keyEl) path.unshift(keyEl.textContent);
    node = node.parentElement.closest(".json-item");
  }
  return path.join(" > ");
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}