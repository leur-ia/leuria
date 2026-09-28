/**
 * For packages that build their own Leuria elements (such as the Ask panel
 * of `@leuria/docs`): the base element, with Pearl's tokens and the Connect
 * UI's styles in its shadow root, the default client, and the icons.
 *
 *   class MyElement extends LeuriaElement {
 *     static styles = `.panel { … }`
 *     protected update() { … }
 *   }
 */
export { defaultClient, onDefaultClient, setDefaultClient } from "./client.js";
export { LeuriaElement, setDefaultAppearance } from "./element.js";
export { FONT_FAMILY, loadFonts } from "./fonts.js";
export { esc, icon, mark } from "./icons.js";
export { insteadLabel } from "./connect-button.js";
