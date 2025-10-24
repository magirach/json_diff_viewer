// -----------------------------
// JSON Viewer Script (Final — Manual Format + Nested JSON + File Support)
// -----------------------------

let jsonData = null;
let rawJsonText = "";
let currentPath = [];
let ignoredKeys = new Set();
let contextMenu = null;

// ---------- DOM Helpers ----------
function $(selector) {
  return document.querySelector(selector);
}
function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------- Safe JSON Beautifier ----------
function beautifyJSON(text) {
  try {
    const obj = JSON.parse(text);
    return JSON.stringify(obj, null, 2);
  } catch {
    return text;
  }
}

// ---------- JavaScript Beautifier ----------
function beautifyJS(code) {
  if (typeof code !== "string") return code;
  if (!/(function\s*\(|=>|var |let |const )/.test(code)) return code;
  let indent = 0;
  const pad = "  ";
  let out = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") {
      out += " {\n" + pad.repeat(++indent);
    } else if (c === "}") {
      indent = Math.max(0, indent - 1);
      out += "\n" + pad.repeat(indent) + "}";
    } else if (c === ";") {
      out += ";\n" + pad.repeat(indent);
    } else out += c;
  }
  return out;
}

// ---------- Nested JSON Parser (Deep Any Level) ----------
function parseNestedKeysDeep(obj, keysToParse) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (keysToParse.includes(key) && typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        obj[key] = parsed;
      } catch {
        // ignore non-JSON strings
      }
    }
    if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = parseNestedKeysDeep(obj[key], keysToParse);
    }
  }
  return obj;
}

// ---------- Breadcrumb ----------
function renderBreadcrumb() {
  const bc = $("#breadcrumb");
  if (!bc) return;
  bc.innerHTML = "";
  if (!currentPath.length) {
    bc.textContent = "📂 Root";
    return;
  }
  const root = createElement("span", "breadcrumb-item", "📂 Root");
  root.onclick = () => {
    currentPath = [];
    refreshView();
  };
  bc.append(root);
  currentPath.forEach((part, i) => {
    bc.append(createElement("span", "breadcrumb-sep", " › "));
    const crumb = createElement("span", "breadcrumb-item", part);
    crumb.onclick = () => {
      currentPath = currentPath.slice(0, i + 1);
      refreshView();
    };
    bc.append(crumb);
  });
}

// ---------- JSON Renderer ----------
function renderJSON(data, container, level = 0, path = []) {
  container.innerHTML = "";
  const ul = createElement("ul", "json-level");

  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      const li = createElement("li", "json-item");
      const keySpan = createElement("span", "json-key", `[${i}]`);
      keySpan.onclick = () => {
        if (typeof item === "object" && item !== null) {
          currentPath = [...path, String(i)];
          refreshView();
        }
      };

      if (typeof item === "object" && item !== null) {
        const toggle = createElement("span", "toggle", "-");
        toggle.onclick = (e) => {
          e.stopPropagation();
          toggleCollapse(li, toggle);
        };
        keySpan.prepend(toggle);
        const child = createElement("div", "child-container");
        renderJSON(item, child, level + 1, [...path, String(i)]);
        li.append(keySpan, child);
      } else {
        const pre = createElement("pre", "json-value");
        pre.textContent = beautifyJS(item);
        li.append(keySpan, pre);
      }
      ul.append(li);
    });
  } else if (typeof data === "object" && data !== null) {
    Object.keys(data).forEach((key) => {
      if (ignoredKeys.has(key)) return;
      const li = createElement("li", "json-item");
      const keySpan = createElement("span", "json-key", key + ": ");
      const val = data[key];
      const hasChildren = typeof val === "object" && val !== null;

      if (hasChildren) {
        const toggle = createElement("span", "toggle", "-");
        toggle.onclick = (e) => {
          e.stopPropagation();
          toggleCollapse(li, toggle);
        };
        keySpan.prepend(toggle);
      }

      keySpan.onclick = (e) => {
        if (e.target.classList.contains("toggle")) return;
        if (hasChildren) {
          currentPath = [...path, key];
          refreshView();
        }
      };

      if (hasChildren) {
        const child = createElement("div", "child-container");
        renderJSON(val, child, level + 1, [...path, key]);
        li.append(keySpan, child);
      } else {
        const pre = createElement("pre", "json-value");
        pre.textContent = beautifyJS(val);
        li.append(keySpan, pre);
      }
      ul.append(li);
    });
  } else {
    const pre = createElement("pre", "json-value");
    pre.textContent = beautifyJS(data);
    ul.append(pre);
  }
  container.append(ul);
}

// ---------- Expand / Collapse ----------
function toggleCollapse(li, toggle) {
  const child = li.querySelector(".child-container");
  if (child) {
    const collapsed = child.style.display === "none";
    child.style.display = collapsed ? "block" : "none";
    toggle.textContent = collapsed ? "-" : "+";
  }
}
function expandAll() {
  document.querySelectorAll(".child-container").forEach((el) => (el.style.display = "block"));
  document.querySelectorAll(".toggle").forEach((t) => (t.textContent = "-"));
}
function collapseAll() {
  document.querySelectorAll(".child-container").forEach((el) => (el.style.display = "none"));
  document.querySelectorAll(".toggle").forEach((t) => (t.textContent = "+"));
}

// ---------- Path Navigation ----------
function getObjectAtPath(obj, path) {
  let current = obj;
  for (const key of path) {
    if (current == null) return null;
    if (Array.isArray(current)) {
      const i = parseInt(key, 10);
      if (!isNaN(i) && i < current.length) current = current[i];
      else return null;
    } else if (typeof current === "object" && key in current) {
      current = current[key];
    } else return null;
  }
  return current;
}

// ---------- Refresh ----------
function refreshView() {
  if (!jsonData) return;
  renderBreadcrumb();
  const data = currentPath.length ? getObjectAtPath(jsonData, currentPath) : jsonData;
  if (!data) {
    $("#views").innerHTML = "<div class='view-placeholder'>Path not found.</div>";
    return;
  }
  renderJSON(data, $("#views"), 0, currentPath);
}

// ---------- File Handling ----------
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    rawJsonText = ev.target.result.trim();
    $("#views").innerHTML = "<div class='view-placeholder'>File loaded. Click Format JSON to view.</div>";
    jsonData = null;
  };
  reader.readAsText(file);
}

// ---------- Format Button ----------
function formatJson() {
  let text = $("#jsonInput").value.trim();
  // If no text but file was loaded
  if (!text && rawJsonText) text = rawJsonText;
  if (!text) return alert("Please paste or load a JSON file first.");
  try {
    rawJsonText = text;
    const formatted = beautifyJSON(text);
    jsonData = JSON.parse(formatted);
    currentPath = [];
    refreshView();
  } catch (err) {
    alert("❌ Invalid JSON: " + err.message);
  }
}

// ---------- Nested Refresh ----------
function reparseAndRefresh() {
  if (!rawJsonText.trim()) return alert("⚠️ Load JSON first.");
  try {
    const obj = JSON.parse(rawJsonText);
    const keys = parseNestedKeysInput();
    jsonData = keys.length ? parseNestedKeysDeep(obj, keys) : obj;
    currentPath = [];
    refreshView();
  } catch (err) {
    alert("❌ Invalid JSON: " + err.message);
  }
}

// ---------- Utility ----------
function parseNestedKeysInput() {
  const input = $("#nestedKeys").value.trim();
  return input ? input.split(",").map((k) => k.trim()) : [];
}
function resetAll() {
  jsonData = null;
  rawJsonText = "";
  ignoredKeys.clear();
  currentPath = [];
  $("#views").innerHTML = '<div class="view-placeholder">Upload or paste a JSON to view</div>';
  $("#breadcrumb").innerHTML = "";
  $("#jsonInput").value = "";
  $("#nestedKeys").value = "";
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  $("#fileInput").addEventListener("change", handleFileSelect);
  $("#formatJson").addEventListener("click", formatJson);
  $("#refreshData").addEventListener("click", reparseAndRefresh);
  $("#expandAll").addEventListener("click", expandAll);
  $("#collapseAll").addEventListener("click", collapseAll);
});


