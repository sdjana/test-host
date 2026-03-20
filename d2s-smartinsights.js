console.log("Testing Smart Insights Bundle");

function runOnEveryPage() {
  console.log("This runs on every page load");
  // your logic here
}

// Option 1: DOM ready
document.addEventListener("DOMContentLoaded", runOnEveryPage);

// Option 2: full load (includes images, etc.)
window.addEventListener("load", runOnEveryPage);
