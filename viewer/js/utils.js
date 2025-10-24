function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clearHighlights() {
  document.querySelectorAll(".highlight").forEach(el => (el.outerHTML = el.innerText));
}

function showAllNodes() {
  document.querySelectorAll(".json-item").forEach(el => (el.style.display = ""));
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
