document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ JSON Viewer initialized");

  // Load viewer setup
  if (typeof initViewer === "function") initViewer();

  // Load search setup
  if (typeof initSearch === "function") initSearch();
});
