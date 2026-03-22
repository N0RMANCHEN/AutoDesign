const PLUGIN_LABEL = "AutoDesign Smoke";

function buildMessage() {
  const pageName = figma.currentPage && figma.currentPage.name ? figma.currentPage.name : "Unknown Page";
  const selectionCount =
    figma.currentPage && figma.currentPage.selection ? figma.currentPage.selection.length : 0;

  return `${PLUGIN_LABEL} loaded. Page: ${pageName}. Selection: ${selectionCount}.`;
}

function run() {
  const message = buildMessage();
  console.log(message);
  figma.notify(message, { timeout: 4000 });
  figma.closePlugin(message);
}

run();
