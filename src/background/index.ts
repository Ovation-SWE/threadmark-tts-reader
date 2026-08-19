import { loadPreferences, savePreferences } from "../content/stateSync";

browser.runtime.onInstalled.addListener(async () => {
  const prefs = await loadPreferences();
  await savePreferences(prefs);
});
