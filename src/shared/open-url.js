// A web or mail link opened in the system's own handler (the browser), as a text view's link would be.
import { appHome, exec } from "herdr";

export function openUrl(url) {
  if (!/^(https?|mailto):/i.test(url)) return;
  if (appHome().includes("\\")) exec("rundll32", ["url.dll,FileProtocolHandler", url]).catch(() => {});
  else exec("open", [url]).catch(() => exec("xdg-open", [url]).catch(() => {}));
}
