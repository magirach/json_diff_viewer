/* ---------- Globals ---------- */
let fullDiffsCache = [];
let activeFilterPath = null;

/* ---------- JSON Diff Worker (supports multi-level unique keys) ---------- */
const workerCode = `
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const norm=s=>typeof s==='string'?s.replace(/\\r\\n/g,'\\n').trim():s;

function normalize(o){if(Array.isArray(o))return o.map(normalize);
if(isObj(o)){const s={};Object.keys(o).sort().forEach(k=>s[k]=normalize(o[k]));return s;}return norm(o);}

function parseNested(o,keys){if(!keys.length)return o;
function deep(x){if(Array.isArray(x))return x.map(deep);
if(!isObj(x))return x;for(const k in x){
if(keys.includes(k)&&typeof x[k]==='string'){try{x[k]=JSON.parse(x[k]);}catch{}}
if(isObj(x[k])||Array.isArray(x[k]))x[k]=deep(x[k]);}return x;}return deep(o);}

function removeIgnored(o,ignore){if(!isObj(o))return o;
const c=Array.isArray(o)?[]:{};for(const k in o){
if(ignore.includes(k))continue;const v=o[k];
c[k]=isObj(v)?removeIgnored(v,ignore):v;}return c;}

function resolveUniqueKey(path, uniqueKeys){
  for(const p in uniqueKeys){
    if(path===p||path.startsWith(p+'.'))return uniqueKeys[p];
  }
  return null;
}

function* walkDiff(a,b,path,uniqueKeys,ignore){
  if(JSON.stringify(a)===JSON.stringify(b))return;
  if(Array.isArray(a)&&Array.isArray(b)){
    const activeKey=resolveUniqueKey(path,uniqueKeys);
    if(activeKey){
      const mapA=new Map(a.map(i=>[i[activeKey],i]));
      const mapB=new Map(b.map(i=>[i[activeKey],i]));
      const keys=new Set([...mapA.keys(),...mapB.keys()]);
      for(const k of keys)
        yield* walkDiff(mapA.get(k),mapB.get(k),\`\${path}[\${activeKey}=\${k}]\`,uniqueKeys,ignore);
      return;
    }
    const len=Math.max(a.length,b.length);
    for(let i=0;i<len;i++)
      yield* walkDiff(a[i],b[i],path+'['+i+']',uniqueKeys,ignore);
    return;
  }
  if(isObj(a)&&isObj(b)){
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    for(const k of keys){
      if(ignore.includes(k))continue;
      yield* walkDiff(a[k],b[k],path?(path+'.'+k):k,uniqueKeys,ignore);
    }
    return;
  }
  yield {path,a,b};
}

onmessage=e=>{
  try{
    let {t1,t2,ignore,nested,uniqueKeys}=e.data;
    let j1=JSON.parse(t1), j2=JSON.parse(t2);
    j1=parseNested(j1,nested);j2=parseNested(j2,nested);
    j1=normalize(removeIgnored(j1,ignore));
    j2=normalize(removeIgnored(j2,ignore));
    const gen=walkDiff(j1,j2,'',uniqueKeys,ignore);
    const diffs=[];
    function step(){
      let c=0,r=gen.next();
      while(!r.done&&c<200){diffs.push(r.value);c++;r=gen.next();}
      if(!r.done){postMessage({progress:diffs.length});setTimeout(step,5);}
      else postMessage({done:true,res:diffs});
    }
    step();
  }catch(err){postMessage({error:err.message});}
};
`;

const workerURL = URL.createObjectURL(
  new Blob([workerCode], { type: "application/javascript" })
);

/* ---------- Utilities ---------- */
// Make sure this function exists in your script:

function escapeHtml(text) {
  if (typeof text !== "string") {
    text = String(text);
  }
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
async function readFile(input) {
  return new Promise((r) => {
    const f = input.files[0];
    if (!f) return r(null);
    const fr = new FileReader();
    fr.onload = (e) => r(e.target.result);
    fr.readAsText(f);
  });
}

/* ---------- Resolve active unique key for current path ---------- */
function resolveLevelUniqueKey(currentPath) {
  const input = document.getElementById("uniqueKey").value.trim();
  if (!input) return null;
  const mappings = {};
  input
    .split(",")
    .map((x) => x.trim())
    .forEach((p) => {
      const [path, key] = p.split(":").map((z) => z.trim());
      if (path && key) mappings[path] = key;
    });
  let best = null,
    depth = 0;
  for (const p in mappings) {
    if (currentPath === p || currentPath.startsWith(p + ".")) {
      const d = p.split(".").length;
      if (d >= depth) {
        best = { path: p, key: mappings[p] };
        depth = d;
      }
    }
  }
  return best;
}

/* ---------- Char-level diff ---------- */
function charDiff(a, b) {
  // Convert to strings and handle null/undefined
  a = a == null ? "" : String(a);
  b = b == null ? "" : String(b);

  // If strings are identical, return them as-is
  if (a === b) {
    return [escapeHtml(a), escapeHtml(b)];
  }

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }

  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const samePrefix = a.slice(0, start);
  const sameSuffix = a.slice(endA + 1);
  const deletedPart = a.slice(start, endA + 1);
  const addedPart = b.slice(start, endB + 1);

  const leftResult =
    escapeHtml(samePrefix) +
    (deletedPart
      ? `<span class="del-highlight">${escapeHtml(deletedPart)}</span>`
      : "") +
    escapeHtml(sameSuffix);

  const rightResult =
    escapeHtml(samePrefix) +
    (addedPart
      ? `<span class="add-highlight">${escapeHtml(addedPart)}</span>`
      : "") +
    escapeHtml(sameSuffix);

  return [leftResult, rightResult];
}

/* ---------- Start Compare ---------- */
async function startCompare() {
  const f1 = await readFile(document.getElementById("file1"));
  const f2 = await readFile(document.getElementById("file2"));
  const t1 = f1 || document.getElementById("json1").value;
  const t2 = f2 || document.getElementById("json2").value;
  if (!t1 || !t2) {
    alert("Please provide both JSONs");
    return;
  }

  const ignore = document
    .getElementById("ignoreKeys")
    .value.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const nested = document
    .getElementById("nestedKeys")
    .value.split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  // multi-level unique key parser
  const uniqueKeys = {};
  const raw = document.getElementById("uniqueKey").value.trim();
  if (raw) {
    raw
      .split(",")
      .map((x) => x.trim())
      .forEach((pair) => {
        const [p, k] = pair.split(":").map((z) => z.trim());
        if (p && k) uniqueKeys[p] = k;
      });
  }

  const showOnly = true;
  const L = document.getElementById("leftView");
  const R = document.getElementById("rightView");
  const prog = document.getElementById("progress");
  L.textContent = R.textContent = "⏳ Comparing...";
  prog.textContent = "";

  const worker = new Worker(workerURL);
  worker.postMessage({ t1, t2, ignore, nested, uniqueKeys });
  worker.onmessage = (e) => {
    const { progress, done, res, error } = e.data;
    if (error) {
      L.textContent = R.textContent = "❌ " + error;
      prog.textContent = "";
      worker.terminate();
      return;
    }
    if (progress)
      prog.textContent = "Processed " + progress + " differences...";
    if (done) {
      prog.textContent = "";
      worker.terminate();
      if (!res.length) {
        L.textContent = R.textContent = "✅ No differences found";
        return;
      }
      renderSideBySideFiltered(res, showOnly);
    }
  };
}

/* ---------- Tree Rendering ---------- */
function renderSideBySide(diffs, showOnly) {
  const L = document.getElementById("leftView");
  const R = document.getElementById("rightView");

  // Create the structure with navigation info
  L.innerHTML = `
    <div class="view-header">
      <span>Original (Left) ${
        activeFilterPath ? `- ${activeFilterPath}` : ""
      }</span>
    </div>
    <div class="tree-controls">
      <button onclick="expandAllNodes()">Expand All</button>
      <button onclick="collapseAllNodes()">Collapse All</button>
      <button onclick="synchronizeRowHeights()">Sync Heights</button>
      ${
        activeFilterPath
          ? '<button onclick="navigateToBreadcrumb(getParentPath(activeFilterPath))">⬆ Parent</button>'
          : ""
      }
    </div>
    <div class="tree-content"></div>
  `;

  R.innerHTML = `
    <div class="view-header">
      <span>Modified (Right) ${
        activeFilterPath ? `- ${activeFilterPath}` : ""
      }</span>
    </div>
    <div class="tree-controls">
      <button onclick="expandAllNodes()">Expand All</button>
      <button onclick="collapseAllNodes()">Collapse All</button>
      <button onclick="synchronizeRowHeights()">Sync Heights</button>
      ${
        activeFilterPath
          ? '<button onclick="navigateToBreadcrumb(getParentPath(activeFilterPath))">⬆ Parent</button>'
          : ""
      }
    </div>
    <div class="tree-content"></div>
  `;

  const leftContent = L.querySelector(".tree-content");
  const rightContent = R.querySelector(".tree-content");

  L.className = "view";
  R.className = "view";

  const buildTree = (d) => {
    const root = {};
    d.forEach(({ path, a, b }) => {
      const parts = path.split(".");
      let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        n[k] = n[k] || {};
        n = n[k];
      }
      n[parts[parts.length - 1]] = { a, b };
    });
    return root;
  };

  const tree = buildTree(diffs);

  const leftTree = document.createElement("div");
  leftTree.className = "tree";
  leftTree.appendChild(createExpandableTreeDom(tree, true));

  const rightTree = document.createElement("div");
  rightTree.className = "tree";
  rightTree.appendChild(createExpandableTreeDom(tree, false));

  leftContent.appendChild(leftTree);
  rightContent.appendChild(rightTree);

  // Use requestAnimationFrame to ensure DOM is ready before setting up sync
  requestAnimationFrame(() => {
    syncScroll(L, R);
    attachKeyClickHandlers();
    updateBreadcrumb(); // Ensure breadcrumb is updated after render

    // Synchronize heights after a brief delay to ensure content is rendered
    setTimeout(() => {
      synchronizeRowHeights();
    }, 100);
  });
}

// Replace the syncScroll function and update renderSideBySide with this complete fix:

/* ---------- Enhanced Scroll Sync (COMPLETE FIX) ---------- */
function syncScroll(leftView, rightView) {
  // Find the scrollable content areas
  const leftScrollable = leftView.querySelector(".tree-content");
  const rightScrollable = rightView.querySelector(".tree-content");

  if (!leftScrollable || !rightScrollable) {
    console.warn("Scroll sync: Could not find tree-content elements");
    return;
  }

  // Remove any existing scroll listeners
  leftScrollable.removeEventListener("scroll", leftScrollable._syncHandler);
  rightScrollable.removeEventListener("scroll", rightScrollable._syncHandler);

  let isLeftScrolling = false;
  let isRightScrolling = false;

  // Create the scroll handlers
  const leftScrollHandler = function () {
    if (isRightScrolling) return;
    isLeftScrolling = true;

    rightScrollable.scrollTop = leftScrollable.scrollTop;
    rightScrollable.scrollLeft = leftScrollable.scrollLeft;

    // Reset flag after a brief delay
    setTimeout(() => {
      isLeftScrolling = false;
    }, 50);
  };

  const rightScrollHandler = function () {
    if (isLeftScrolling) return;
    isRightScrolling = true;

    leftScrollable.scrollTop = rightScrollable.scrollTop;
    leftScrollable.scrollLeft = rightScrollable.scrollLeft;

    // Reset flag after a brief delay
    setTimeout(() => {
      isRightScrolling = false;
    }, 50);
  };

  // Store handlers on elements for removal later
  leftScrollable._syncHandler = leftScrollHandler;
  rightScrollable._syncHandler = rightScrollHandler;

  // Add the scroll listeners
  leftScrollable.addEventListener("scroll", leftScrollHandler, {
    passive: true,
  });
  rightScrollable.addEventListener("scroll", rightScrollHandler, {
    passive: true,
  });

  console.log("Scroll sync enabled between tree-content elements");
}

// Update the renderSideBySide function to ensure proper timing
function renderSideBySide(diffs, showOnly) {
  const L = document.getElementById("leftView");
  const R = document.getElementById("rightView");

  // Create the structure
  L.innerHTML = `
    <div class="view-header">
      <span>Original (Left)</span>
    </div>
    <div class="tree-controls">
      <button onclick="expandAllNodes()">Expand All</button>
      <button onclick="collapseAllNodes()">Collapse All</button>
      <button onclick="synchronizeRowHeights()">Sync Heights</button>
    </div>
    <div class="tree-content"></div>
  `;

  R.innerHTML = `
    <div class="view-header">
      <span>Modified (Right)</span>
    </div>
    <div class="tree-controls">
      <button onclick="expandAllNodes()">Expand All</button>
      <button onclick="collapseAllNodes()">Collapse All</button>
      <button onclick="synchronizeRowHeights()">Sync Heights</button>
    </div>
    <div class="tree-content"></div>
  `;

  const leftContent = L.querySelector(".tree-content");
  const rightContent = R.querySelector(".tree-content");

  L.className = "view";
  R.className = "view";

  const buildTree = (d) => {
    const root = {};
    d.forEach(({ path, a, b }) => {
      const parts = path.split(".");
      let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        n[k] = n[k] || {};
        n = n[k];
      }
      n[parts[parts.length - 1]] = { a, b };
    });
    return root;
  };

  const tree = buildTree(diffs);

  const leftTree = document.createElement("div");
  leftTree.className = "tree";
  leftTree.appendChild(createExpandableTreeDom(tree, true));

  const rightTree = document.createElement("div");
  rightTree.className = "tree";
  rightTree.appendChild(createExpandableTreeDom(tree, false));

  leftContent.appendChild(leftTree);
  rightContent.appendChild(rightTree);

  // Use requestAnimationFrame to ensure DOM is ready before setting up sync
  requestAnimationFrame(() => {
    syncScroll(L, R);
    attachKeyClickHandlers();

    // Synchronize heights after a brief delay to ensure content is rendered
    setTimeout(() => {
      synchronizeRowHeights();
    }, 100);
  });
}

// Also ensure the renderSideBySideFiltered function has the same fix
function renderSideBySideFiltered(diffs, showOnly) {
  fullDiffsCache = diffs;
  activeFilterPath = null;
  renderSideBySide(diffs, showOnly);
}

// Also update the renderSideBySide function to ensure proper structure:

/* ---------- Breadcrumb ---------- */
function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");

  if (!activeFilterPath) {
    breadcrumb.innerHTML =
      '<span class="breadcrumb-item root active">🏠 Root</span>';
    return;
  }

  const parts = activeFilterPath.split(".");
  let html =
    '<span class="breadcrumb-item root" onclick="navigateToBreadcrumb(\'\')">🏠 Root</span>';

  let currentPath = "";
  parts.forEach((part, index) => {
    currentPath = currentPath ? currentPath + "." + part : part;
    const isLast = index === parts.length - 1;
    const className = isLast ? "breadcrumb-item active" : "breadcrumb-item";

    html += ` <span class="breadcrumb-separator">›</span> `;
    html += `<span class="${className}" onclick="navigateToBreadcrumb('${currentPath}')">${escapeHtml(
      part
    )}</span>`;
  });

  breadcrumb.innerHTML = html;
}

function navigateToBreadcrumb(path) {
  console.log(`Navigating to breadcrumb path: "${path}"`);

  if (!path) {
    // Navigate to root
    activeFilterPath = null;
    renderSideBySide(fullDiffsCache, false);
    updateBreadcrumb();
    return;
  }

  // Set the new active filter path
  activeFilterPath = path;

  // Filter diffs to show only items at this path level and below
  const filtered = fullDiffsCache.filter(({ path: diffPath }) => {
    return diffPath === path || diffPath.startsWith(path + ".");
  });

  console.log(`Filtered ${filtered.length} items for path: "${path}"`);

  if (filtered.length === 0) {
    console.warn(`No items found for path: "${path}"`);
    return;
  }

  // Render the filtered view
  renderSideBySide(filtered, false);
  updateBreadcrumb();

  // Update unique key filter if applicable
  updateUniqueKeyDropdown(filtered);
}

// Update the key click handler to work better with breadcrumbs:
function attachKeyClickHandlers() {
  document.querySelectorAll(".tree .key").forEach((keyEl) => {
    const path = keyEl.dataset.fullpath;

    keyEl.onclick = (e) => {
      if (!path) return;
      e.stopPropagation();

      console.log(
        `Key clicked: "${path}", current active path: "${activeFilterPath}"`
      );

      // If clicking the same path that's already active, go back to parent
      if (activeFilterPath === path) {
        const parentPath = getParentPath(path);
        navigateToBreadcrumb(parentPath);
        return;
      }

      // Check if this path has children
      const hasChildren = fullDiffsCache.some(
        ({ path: diffPath }) =>
          diffPath.startsWith(path + ".") && diffPath !== path
      );

      if (hasChildren) {
        // Navigate to this path to show its children
        navigateToBreadcrumb(path);
      } else {
        // If no children, this is a leaf node - highlight it
        highlightLeafNode(path);
      }
    };

    keyEl.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.pageX, e.pageY, path.split(".").pop());
    };
  });
}

// Helper function to get parent path
function getParentPath(path) {
  if (!path) return null;
  const parts = path.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

// Helper function to highlight leaf nodes
function highlightLeafNode(path) {
  // Remove previous highlights
  document.querySelectorAll(".tree .key.highlighted").forEach((el) => {
    el.classList.remove("highlighted");
  });

  // Highlight the clicked leaf nodes
  document
    .querySelectorAll(`.tree .key[data-fullpath="${path}"]`)
    .forEach((el) => {
      el.classList.add("highlighted");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });

  // Remove highlight after 3 seconds
  setTimeout(() => {
    document.querySelectorAll(".tree .key.highlighted").forEach((el) => {
      el.classList.remove("highlighted");
    });
  }, 3000);
}

// Enhanced navigation with keyboard support
document.addEventListener("keydown", (e) => {
  // Only handle if we're not in an input field
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if (e.key === "Escape") {
    // Go back to parent on Escape
    if (activeFilterPath) {
      const parentPath = getParentPath(activeFilterPath);
      navigateToBreadcrumb(parentPath || "");
    }
  } else if (e.key === "Home") {
    // Go to root on Home
    navigateToBreadcrumb("");
  }
});

/* ---------- Unique Key Dropdown (Multi-level aware) ---------- */
function updateUniqueKeyDropdown(diffs = []) {
  const currentPath = activeFilterPath || "";
  const info = resolveLevelUniqueKey(currentPath);
  const container = document.getElementById("uniqueKeyFilterContainer");
  const box = document.getElementById("uniqueKeyCheckboxContainer");
  if (!info) {
    container.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const { path: uniquePath, key: uniqueKey } = info;
  const all = fullDiffsCache.length ? fullDiffsCache : diffs;
  const vals = new Set();
  all.forEach(({ path }) => {
    if (path.startsWith(uniquePath)) {
      const m = path.match(new RegExp(`\\[${uniqueKey}=([^\\]]+)\\]`));
      if (m && m[1]) vals.add(m[1]);
    }
  });
  container.style.display = "block";
  box.innerHTML = "";
  if (!vals.size) {
    box.innerHTML = `<em>(no ${uniqueKey} found for ${uniquePath})</em>`;
    return;
  }
  const prev = getSelectedUniqueValues();
  const hdr = document.createElement("div");
  hdr.className = "unique-header";
  hdr.textContent = `Filtering by ${uniqueKey} (${uniquePath})`;
  box.appendChild(hdr);
  Array.from(vals).forEach((v) => {
    const id = `chk_${uniqueKey}_${v}`;
    const lbl = document.createElement("label");
    lbl.innerHTML = `<input type="checkbox" id="${id}" value="${v}" ${
      prev.length === 0 || prev.includes(v) ? "checked" : ""
    }> ${v}`;
    box.appendChild(lbl);
  });
  box.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    chk.addEventListener("change", () => {
      const sel = getSelectedUniqueValues();
      applyUniqueKeyFilter(sel, uniqueKey, uniquePath);
    });
  });
  document.getElementById("selectAllKeys").onclick = () => {
    box
      .querySelectorAll("input[type=checkbox]")
      .forEach((c) => (c.checked = true));
    applyUniqueKeyFilter(getSelectedUniqueValues(), uniqueKey, uniquePath);
  };
  document.getElementById("deselectAllKeys").onclick = () => {
    box
      .querySelectorAll("input[type=checkbox]")
      .forEach((c) => (c.checked = false));
    applyUniqueKeyFilter([], uniqueKey, uniquePath);
  };
  document.getElementById("resetKeyFilter").onclick = () => {
    box
      .querySelectorAll("input[type=checkbox]")
      .forEach((c) => (c.checked = true));
    renderSideBySideFiltered(fullDiffsCache, false);
  };
}

function getSelectedUniqueValues() {
  return Array.from(
    document.querySelectorAll(
      "#uniqueKeyCheckboxContainer input[type=checkbox]:checked"
    )
  ).map((c) => c.value);
}

function applyUniqueKeyFilter(selected, uniqueKey, uniquePath) {
  if (!selected.length) {
    renderSideBySideFiltered(fullDiffsCache, false);
    return;
  }
  const f = fullDiffsCache.filter(
    ({ path }) =>
      path.startsWith(uniquePath) &&
      selected.some((v) => path.includes("`[${uniqueKey}=${v}]`"))
  );
  renderSideBySide(f, false);
  attachKeyClickHandlers();
  updateBreadcrumb();
  updateUniqueKeyDropdown(f);
}

/* ---------- Context Menu ---------- */
const contextMenu = document.getElementById("contextMenu");

function showContextMenu(x, y, keyName) {
  const ignore = document.getElementById("ignoreKeys");
  const nested = document.getElementById("nestedKeys");
  const unique = document.getElementById("uniqueKey");

  const ignoreKeys = ignore.value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const nestedKeys = nested.value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const uniqueKey = unique.value.trim();

  const isIgnored = ignoreKeys.includes(keyName);
  const isNested = nestedKeys.includes(keyName);
  const isUnique = uniqueKey === keyName;

  contextMenu.innerHTML = `
    <div class="context-menu-item" data-action="toggle-ignore">
      ${isIgnored ? "➖ Remove from" : "➕ Add to"} Ignore Keys
    </div>
    <div class="context-menu-item" data-action="toggle-nested">
      ${isNested ? "➖ Remove from" : "➕ Add to"} JSON-containing Keys
    </div>
    <div class="context-menu-item" data-action="toggle-unique">
      ${isUnique ? "➖ Remove as" : "➕ Set as"} Unique Key
    </div>
    <hr>
    <div class="context-menu-item" data-action="beautify-js">✨ Beautify JavaScript Code</div>
  `;

  contextMenu.style.left = x + "px";
  contextMenu.style.top = y + "px";
  contextMenu.style.display = "block";

  contextMenu.querySelectorAll(".context-menu-item").forEach((item) => {
    item.addEventListener("click", () =>
      handleContextAction(item.dataset.action, keyName)
    );
  });

  document.addEventListener(
    "click",
    () => (contextMenu.style.display = "none"),
    { once: true }
  );
}
function handleContextAction(action, keyName) {
  const ignore = document.getElementById("ignoreKeys");
  const nested = document.getElementById("nestedKeys");
  const unique = document.getElementById("uniqueKey");
  const modify = (input, add) => {
    let arr = input.value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (add && !arr.includes(keyName)) arr.push(keyName);
    if (!add) arr = arr.filter((k) => k !== keyName);
    input.value = arr.join(", ");
  };
  switch (action) {
    case "toggle-ignore": {
      const arr = ignore.value
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      modify(ignore, !arr.includes(keyName));
      break;
    }
    case "toggle-nested": {
      const arr = nested.value
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      modify(nested, !arr.includes(keyName));
      break;
    }
    case "toggle-unique": {
      unique.value = unique.value.trim() === keyName ? "" : keyName;
      break;
    }
    case "beautify-js": {
      beautifyJavaScriptKeyValue(keyName);
      break;
    }
  }
  contextMenu.style.display = "none";
}
/* ---------- Beautify JavaScript Code (Preserve Diff) ---------- */
// Replace the beautifyJavaScriptKeyValue function with this fixed version:

/* ---------- Beautify JavaScript Code (FIXED) ---------- */
function beautifyJavaScriptKeyValue(keyName) {
  const leftView = document.getElementById("leftView");
  const rightView = document.getElementById("rightView");

  // Find all key elements with the specified name
  const leftKeys = Array.from(leftView.querySelectorAll(".tree .key")).filter(
    (key) => key.textContent.trim() === keyName
  );
  const rightKeys = Array.from(rightView.querySelectorAll(".tree .key")).filter(
    (key) => key.textContent.trim() === keyName
  );

  let formatted = false;

  // Process each matching key
  leftKeys.forEach((leftKey, index) => {
    // Find corresponding right key
    const rightKey = rightKeys[index];

    // Get the value elements (next sibling of key)
    const leftVal = leftKey.parentElement.querySelector(".value");
    const rightVal = rightKey
      ? rightKey.parentElement.querySelector(".value")
      : null;

    if (!leftVal) return;

    // Get raw text content, handling both text and HTML content
    let rawLeft = leftVal.textContent || leftVal.innerText || "";
    let rawRight = rightVal
      ? rightVal.textContent || rightVal.innerText || ""
      : "";

    // Clean up the raw values
    rawLeft = rawLeft.trim();
    rawRight = rawRight.trim();

    // If the value is a JSON string, parse it
    if (rawLeft.startsWith('"') && rawLeft.endsWith('"')) {
      try {
        rawLeft = JSON.parse(rawLeft);
      } catch (e) {
        // If parsing fails, remove quotes manually
        rawLeft = rawLeft.slice(1, -1);
      }
    }

    if (rawRight.startsWith('"') && rawRight.endsWith('"')) {
      try {
        rawRight = JSON.parse(rawRight);
      } catch (e) {
        // If parsing fails, remove quotes manually
        rawRight = rawRight.slice(1, -1);
      }
    }

    // Check if it looks like JavaScript code
    if (isJavaScriptCode(rawLeft) || isJavaScriptCode(rawRight)) {
      try {
        // Beautify both sides
        const formattedLeft = rawLeft ? jsBeautify(rawLeft) : "";
        const formattedRight = rawRight ? jsBeautify(rawRight) : "";

        // Create diff highlighting
        const [diffLeft, diffRight] = charDiff(formattedLeft, formattedRight);

        // Update the display with beautified code
        leftVal.innerHTML = `<pre class="beautified-js">${diffLeft}</pre>`;
        if (rightVal) {
          rightVal.innerHTML = `<pre class="beautified-js">${diffRight}</pre>`;
        }

        formatted = true;

        // Add a visual indicator that it's been beautified
        leftKey.style.background = "#e8f5e8";
        leftKey.title = "✨ Beautified JavaScript";
        if (rightKey) {
          rightKey.style.background = "#e8f5e8";
          rightKey.title = "✨ Beautified JavaScript";
        }
      } catch (e) {
        console.warn(`Beautify failed for key "${keyName}":`, e);
      }
    }
  });

  if (!formatted) {
    alert(
      `⚠️ No valid JavaScript code found for key "${keyName}".\nMake sure the value contains JavaScript code.`
    );
  } else {
    // Show success message
    const successMsg = document.createElement("div");
    successMsg.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #d4edda;
      color: #155724;
      padding: 10px 20px;
      border-radius: 6px;
      border: 1px solid #c3e6cb;
      z-index: 1000;
      font-weight: 500;
    `;
    successMsg.textContent = `✨ JavaScript code beautified for "${keyName}"`;
    document.body.appendChild(successMsg);

    setTimeout(() => {
      document.body.removeChild(successMsg);
    }, 3000);
  }
}

/* ---------- Helper function to detect JavaScript code ---------- */
function isJavaScriptCode(str) {
  if (!str || typeof str !== "string") return false;

  // Common JavaScript patterns
  const jsPatterns = [
    /function\s*\(/, // function declarations
    /=>\s*{/, // arrow functions
    /\bvar\s+\w+/, // var declarations
    /\blet\s+\w+/, // let declarations
    /\bconst\s+\w+/, // const declarations
    /\bif\s*\(/, // if statements
    /\bfor\s*\(/, // for loops
    /\bwhile\s*\(/, // while loops
    /\breturn\s+/, // return statements
    /\bconsole\./, // console methods
    /\bdocument\./, // DOM access
    /\bwindow\./, // window object
    /\b(true|false|null|undefined)\b/, // JS literals
    /\bnew\s+\w+/, // constructors
    /\bclass\s+\w+/, // class declarations
    /\bimport\s+/, // ES6 imports
    /\bexport\s+/, // ES6 exports
    /\btry\s*{/, // try blocks
    /\bcatch\s*\(/, // catch blocks
    /\.then\s*\(/, // promises
    /\.map\s*\(/, // array methods
    /\.filter\s*\(/, // array methods
    /\.forEach\s*\(/, // array methods
  ];

  // Check for multiple JavaScript patterns
  const matchCount = jsPatterns.filter((pattern) => pattern.test(str)).length;

  // Also check for basic JavaScript syntax
  const hasJSSyntax =
    str.includes("{") &&
    str.includes("}") &&
    (str.includes(";") || str.includes("function") || str.includes("=>"));

  return matchCount >= 2 || hasJSSyntax;
}

/* ---------- Enhanced JavaScript Beautifier ---------- */
function jsBeautify(code) {
  if (!code || typeof code !== "string") return "";

  const indentStr = "  ";
  let indentLevel = 0;
  let inString = false;
  let stringChar = "";
  let inComment = false;
  let result = "";
  let buffer = "";
  let i = 0;

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      result += indentStr.repeat(Math.max(0, indentLevel)) + trimmed + "\n";
    }
    buffer = "";
  };

  const addLine = (text) => {
    result += indentStr.repeat(Math.max(0, indentLevel)) + text + "\n";
  };

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    const prev = code[i - 1];

    // Handle strings
    if (!inComment && (ch === '"' || ch === "'" || ch === "`")) {
      if (inString && ch === stringChar) {
        if (prev !== "\\") {
          inString = false;
          stringChar = "";
        }
      } else if (!inString) {
        inString = true;
        stringChar = ch;
      }
      buffer += ch;
      i++;
      continue;
    }

    if (inString) {
      buffer += ch;
      i++;
      continue;
    }

    // Handle line comments //
    if (!inComment && ch === "/" && next === "/") {
      flushBuffer();
      let comment = "//";
      i += 2;
      while (i < code.length && code[i] !== "\n") {
        comment += code[i];
        i++;
      }
      addLine(comment);
      continue;
    }

    // Handle block comments /* ... */
    if (!inComment && ch === "/" && next === "*") {
      flushBuffer();
      let comment = "/*";
      i += 2;
      while (i < code.length - 1) {
        comment += code[i];
        if (code[i] === "*" && code[i + 1] === "/") {
          comment += "/";
          i += 2;
          break;
        }
        i++;
      }
      addLine(comment);
      continue;
    }

    // Handle braces and indentation
    if (ch === "{") {
      buffer += ch;
      flushBuffer();
      indentLevel++;
      i++;
      continue;
    }

    if (ch === "}") {
      flushBuffer();
      indentLevel = Math.max(0, indentLevel - 1);
      addLine("}");
      i++;
      continue;
    }

    // Handle semicolons
    if (ch === ";") {
      buffer += ";";
      flushBuffer();
      i++;
      continue;
    }

    // Handle specific keywords that should be on new lines
    if (
      buffer.trim() === "" &&
      (code.substr(i).startsWith("if(") ||
        code.substr(i).startsWith("if ") ||
        code.substr(i).startsWith("else") ||
        code.substr(i).startsWith("for(") ||
        code.substr(i).startsWith("for ") ||
        code.substr(i).startsWith("while(") ||
        code.substr(i).startsWith("while ") ||
        code.substr(i).startsWith("function ") ||
        code.substr(i).startsWith("const ") ||
        code.substr(i).startsWith("let ") ||
        code.substr(i).startsWith("var "))
    ) {
      flushBuffer();
    }

    // Skip whitespace and newlines
    if (ch === "\n" || ch === "\r" || (ch === " " && buffer.trim() === "")) {
      i++;
      continue;
    }

    buffer += ch;
    i++;
  }

  flushBuffer();
  return result.trim();
}

/* ---------- Enhanced Tree Rendering with Expand/Collapse (FIXED) ---------- */
function createExpandableTreeDom(o, isLeft = true, prefix = "") {
  const ul = document.createElement("ul");

  for (const k in o) {
    const li = document.createElement("li");
    const v = o[k];

    if (v && typeof v === "object" && "a" in v && "b" in v) {
      // Leaf node with actual diff
      const { a, b } = v;

      const nodeDiv = document.createElement("div");
      nodeDiv.className = "tree-node";

      const toggle = document.createElement("span");
      toggle.className = "expand-toggle leaf";

      const key = document.createElement("span");
      key.className = "key";
      key.textContent = k;
      key.dataset.fullpath = prefix ? prefix + "." + k : k;

      const val = document.createElement("span");
      val.className = "value";

      // Handle different value types and create appropriate display
      if (a === undefined) {
        val.classList.add("add");
        if (isLeft) {
          val.textContent = "";
        } else {
          if (typeof b === "string") {
            // Check if it's a large string
            if (b.length > 100) {
              val.innerHTML = `<div class="large-content"><span class="add-highlight">${escapeHtml(
                b
              )}</span></div>`;
            } else {
              val.innerHTML = `<span class="add-highlight">${escapeHtml(
                b
              )}</span>`;
            }
          } else {
            const jsonStr = JSON.stringify(b, null, 2);
            if (jsonStr.length > 100) {
              val.classList.add("json-object");
              val.innerHTML = `<span class="add-highlight">${escapeHtml(
                jsonStr
              )}</span>`;
            } else {
              val.innerHTML = `<span class="add-highlight">${escapeHtml(
                jsonStr
              )}</span>`;
            }
          }
        }
      } else if (b === undefined) {
        val.classList.add("del");
        if (isLeft) {
          if (typeof a === "string") {
            // Check if it's a large string
            if (a.length > 100) {
              val.innerHTML = `<div class="large-content"><span class="del-highlight">${escapeHtml(
                a
              )}</span></div>`;
            } else {
              val.innerHTML = `<span class="del-highlight">${escapeHtml(
                a
              )}</span>`;
            }
          } else {
            const jsonStr = JSON.stringify(a, null, 2);
            if (jsonStr.length > 100) {
              val.classList.add("json-object");
              val.innerHTML = `<span class="del-highlight">${escapeHtml(
                jsonStr
              )}</span>`;
            } else {
              val.innerHTML = `<span class="del-highlight">${escapeHtml(
                jsonStr
              )}</span>`;
            }
          }
        } else {
          val.textContent = "";
        }
      } else if (JSON.stringify(a) !== JSON.stringify(b)) {
        val.classList.add("changed");

        // Use char diff for strings, JSON stringify for objects
        if (typeof a === "string" && typeof b === "string") {
          const [da, db] = charDiff(a, b);
          // Check if content is large
          if (a.length > 100 || b.length > 100) {
            val.innerHTML = `<div class="large-content">${
              isLeft ? da : db
            }</div>`;
          } else {
            val.innerHTML = isLeft ? da : db;
          }
        } else {
          const aStr = JSON.stringify(a, null, 2);
          const bStr = JSON.stringify(b, null, 2);
          const [da, db] = charDiff(aStr, bStr);
          if (aStr.length > 100 || bStr.length > 100) {
            val.classList.add("json-object");
          }
          val.innerHTML = isLeft ? da : db;
        }
      } else {
        // Values are the same
        if (typeof a === "string") {
          if (a.length > 100) {
            val.innerHTML = `<div class="large-content">${escapeHtml(a)}</div>`;
          } else {
            val.textContent = a;
          }
        } else {
          const jsonStr = JSON.stringify(a, null, 2);
          if (jsonStr.length > 100) {
            val.classList.add("json-object");
            val.textContent = jsonStr;
          } else {
            val.textContent = jsonStr;
          }
        }
      }

      nodeDiv.appendChild(toggle);
      nodeDiv.appendChild(key);
      nodeDiv.appendChild(val);
      li.appendChild(nodeDiv);
    } else if (typeof v === "object") {
      // Parent node with children
      const nodeDiv = document.createElement("div");
      nodeDiv.className = "tree-node";

      const toggle = document.createElement("span");
      toggle.className = "expand-toggle expanded";

      const key = document.createElement("span");
      key.className = "key";
      key.textContent = k;
      key.dataset.fullpath = prefix ? prefix + "." + k : k;

      // Add type indicators
      const isArray = Array.isArray(v);
      if (isArray) {
        key.classList.add("array-key");
      } else {
        key.classList.add("object-key");
      }

      const childCount = Object.keys(v).length;
      const badge = document.createElement("span");
      badge.style.color = "#656d76";
      badge.style.fontSize = "11px";
      badge.style.marginLeft = "8px";
      badge.style.fontWeight = "normal";
      badge.textContent = `(${childCount})`;

      nodeDiv.appendChild(toggle);
      nodeDiv.appendChild(key);
      nodeDiv.appendChild(badge);

      const childrenDiv = document.createElement("div");
      childrenDiv.className = "tree-children expanded";
      childrenDiv.appendChild(
        createExpandableTreeDom(v, isLeft, prefix ? prefix + "." + k : k)
      );

      // Add click handler for expand/collapse
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTreeNode(toggle, childrenDiv);
        // Re-sync heights after expand/collapse
        setTimeout(() => {
          synchronizeRowHeights();
        }, 50);
      });

      li.appendChild(nodeDiv);
      li.appendChild(childrenDiv);
    }

    ul.appendChild(li);
  }

  return ul;
}

function toggleTreeNode(toggle, childrenDiv, syncWithOtherSide = true) {
  const isExpanded = toggle.classList.contains("expanded");
  const newState = isExpanded ? "collapsed" : "expanded";

  // Update current node
  if (isExpanded) {
    toggle.classList.remove("expanded");
    toggle.classList.add("collapsed");
    childrenDiv.classList.remove("expanded");
    childrenDiv.classList.add("collapsed");
  } else {
    toggle.classList.remove("collapsed");
    toggle.classList.add("expanded");
    childrenDiv.classList.remove("collapsed");
    childrenDiv.classList.add("expanded");
  }

  // Sync with the other side if requested
  if (syncWithOtherSide) {
    syncExpandCollapseState(toggle, newState);
  }
}

function syncExpandCollapseState(sourceToggle, newState) {
  // Find the corresponding toggle in the other view
  const sourceKey = sourceToggle.parentElement.querySelector(".key");
  if (!sourceKey || !sourceKey.dataset.fullpath) return;

  const sourcePath = sourceKey.dataset.fullpath;
  const sourceView = sourceToggle.closest(".view");
  const isLeftView = sourceView.id === "leftView";
  const otherView = document.getElementById(
    isLeftView ? "rightView" : "leftView"
  );

  // Find the corresponding key in the other view
  const otherKey = otherView.querySelector(`[data-fullpath="${sourcePath}"]`);
  if (!otherKey) return;

  const otherToggle = otherKey.parentElement.querySelector(".expand-toggle");
  const otherChildrenDiv = otherKey
    .closest("li")
    .querySelector(".tree-children");

  if (
    otherToggle &&
    otherChildrenDiv &&
    !otherToggle.classList.contains("leaf")
  ) {
    // Update the other side without triggering another sync (prevent infinite loop)
    if (newState === "collapsed") {
      otherToggle.classList.remove("expanded");
      otherToggle.classList.add("collapsed");
      otherChildrenDiv.classList.remove("expanded");
      otherChildrenDiv.classList.add("collapsed");
    } else {
      otherToggle.classList.remove("collapsed");
      otherToggle.classList.add("expanded");
      otherChildrenDiv.classList.remove("collapsed");
      otherChildrenDiv.classList.add("expanded");
    }
  }
}

function expandAllNodes() {
  // Expand all nodes in both views
  document.querySelectorAll(".expand-toggle.collapsed").forEach((toggle) => {
    const childrenDiv = toggle.closest("li").querySelector(".tree-children");
    if (childrenDiv) {
      toggle.classList.remove("collapsed");
      toggle.classList.add("expanded");
      childrenDiv.classList.remove("collapsed");
      childrenDiv.classList.add("expanded");
    }
  });
}

function collapseAllNodes() {
  // Collapse all nodes in both views
  document.querySelectorAll(".expand-toggle.expanded").forEach((toggle) => {
    const childrenDiv = toggle.closest("li").querySelector(".tree-children");
    if (childrenDiv) {
      toggle.classList.remove("expanded");
      toggle.classList.add("collapsed");
      childrenDiv.classList.remove("expanded");
      childrenDiv.classList.add("collapsed");
    }
  });
}

// Add a function to expand/collapse specific paths (useful for programmatic control)
function toggleNodeByPath(path, forceState = null) {
  const leftKey = document.querySelector(`#leftView [data-fullpath="${path}"]`);
  const rightKey = document.querySelector(
    `#rightView [data-fullpath="${path}"]`
  );

  [leftKey, rightKey].forEach((key, index) => {
    if (!key) return;

    const toggle = key.parentElement.querySelector(".expand-toggle");
    const childrenDiv = key.closest("li").querySelector(".tree-children");

    if (toggle && childrenDiv && !toggle.classList.contains("leaf")) {
      const isExpanded = toggle.classList.contains("expanded");
      const shouldExpand = forceState !== null ? forceState : !isExpanded;

      if (shouldExpand && !isExpanded) {
        toggle.classList.remove("collapsed");
        toggle.classList.add("expanded");
        childrenDiv.classList.remove("collapsed");
        childrenDiv.classList.add("expanded");
      } else if (!shouldExpand && isExpanded) {
        toggle.classList.remove("expanded");
        toggle.classList.add("collapsed");
        childrenDiv.classList.remove("expanded");
        childrenDiv.classList.add("collapsed");
      }
    }
  });
}

// Add keyboard shortcuts for expand/collapse
document.addEventListener("keydown", (e) => {
  // Only handle if we're in the tree view area
  if (!e.target.closest(".tree")) return;

  if (e.key === "ArrowRight") {
    // Expand focused node
    const focusedKey = document.activeElement
      .closest(".tree-node")
      ?.querySelector(".key");
    if (focusedKey) {
      toggleNodeByPath(focusedKey.dataset.fullpath, true);
    }
  } else if (e.key === "ArrowLeft") {
    // Collapse focused node
    const focusedKey = document.activeElement
      .closest(".tree-node")
      ?.querySelector(".key");
    if (focusedKey) {
      toggleNodeByPath(focusedKey.dataset.fullpath, false);
    }
  }
});

/* ---------- Synchronized Height Management ---------- */
function synchronizeRowHeights() {
  const leftNodes = document.querySelectorAll("#leftView .tree-node");
  const rightNodes = document.querySelectorAll("#rightView .tree-node");

  // Match nodes by their data-fullpath
  const nodeMap = new Map();

  // Collect all left nodes
  leftNodes.forEach((node) => {
    const key = node.querySelector(".key");
    if (key && key.dataset.fullpath) {
      nodeMap.set(key.dataset.fullpath, { left: node, right: null });
    }
  });

  // Match with right nodes
  rightNodes.forEach((node) => {
    const key = node.querySelector(".key");
    if (key && key.dataset.fullpath) {
      const existing = nodeMap.get(key.dataset.fullpath);
      if (existing) {
        existing.right = node;
      } else {
        nodeMap.set(key.dataset.fullpath, { left: null, right: node });
      }
    }
  });

  // Synchronize heights
  nodeMap.forEach(({ left, right }) => {
    if (left && right) {
      // Reset heights first
      left.style.minHeight = "auto";
      right.style.minHeight = "auto";

      // Force layout recalculation
      left.offsetHeight;
      right.offsetHeight;

      // Get natural heights
      const leftHeight = left.offsetHeight;
      const rightHeight = right.offsetHeight;
      const maxHeight = Math.max(leftHeight, rightHeight);

      // Apply synchronized height
      if (maxHeight > 24) {
        // Only sync if taller than minimum
        left.style.minHeight = maxHeight + "px";
        right.style.minHeight = maxHeight + "px";
      }
    }
  });
}

// Add automatic height sync on window resize
window.addEventListener("resize", () => {
  clearTimeout(window.resizeTimeout);
  window.resizeTimeout = setTimeout(() => {
    synchronizeRowHeights();
  }, 250);
});

/* ---------- Reset ---------- */
function resetAll() {
  // Clear input fields
  document.getElementById("json1").value = "";
  document.getElementById("json2").value = "";
  document.getElementById("ignoreKeys").value = "";
  document.getElementById("nestedKeys").value = "";
  document.getElementById("uniqueKey").value = "";

  // Clear file inputs
  document.getElementById("file1").value = "";
  document.getElementById("file2").value = "";

  // Reset views to placeholder state
  const leftView = document.getElementById("leftView");
  const rightView = document.getElementById("rightView");
  leftView.innerHTML =
    '<div class="view-placeholder">Select JSONs and click Compare</div>';
  rightView.innerHTML =
    '<div class="view-placeholder">Select JSONs and click Compare</div>';

  // Clear progress and breadcrumb
  document.getElementById("progress").textContent = "";
  document.getElementById("breadcrumb").innerHTML = "";

  // Hide unique filter
  document.getElementById("uniqueKeyFilterContainer").style.display = "none";

  // Reset global state
  fullDiffsCache = [];
  activeFilterPath = null;
}

document.addEventListener("DOMContentLoaded", function () {
  const resetBtn = document.querySelector("button.reset");
  if (resetBtn) {
    resetBtn.onclick = resetAll;
  }
});
