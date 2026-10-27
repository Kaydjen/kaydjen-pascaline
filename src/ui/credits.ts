import { el } from "./dom";

/** A link that opens in a new tab without leaking the page address. */
function link(text: string, href: string): HTMLAnchorElement {
  return el("a", { text, attrs: { href, target: "_blank", rel: "noopener noreferrer" } });
}

/**
 * Credits: one small, dim word at the end of the left dock group; it opens a small plate with the sources the licences ask to be named
 * (the paper the model follows, the scans and the light, the fonts, three.js). Closes on a click elsewhere, on Escape and on the word again.
 */
export function mountCredits(): void {
  const dock = document.querySelector(".dock-left");
  if (!dock) return;
  const button = el("button", { class: "credits-button", text: "Credits", attrs: { type: "button", "aria-expanded": "false", "aria-controls": "credits" } });
  const panel = el("div", {
    class: "credits",
    attrs: { id: "credits", role: "dialog", "aria-label": "Credits", hidden: "" },
    children: [
      el("p", {
        children: [
          "Reconstruction after the Pascaline CnAM 823-1 (Musée des Arts et Métiers) and the model of Rojas-Sola, del Río-Cidoncha, Fernández-de la Puente Sarriá and Galiano-Delgado, ",
          link("Machines 2021, 9, 136", "https://doi.org/10.3390/machines9070136"),
          " (",
          link("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
          "), adapted for this page.",
        ],
      }),
      el("p", {
        children: [
          "Scans from ",
          link("ambientCG", "https://ambientcg.com"),
          " and light from ",
          link("Poly Haven", "https://polyhaven.com"),
          " (CC0). Fonts EB Garamond and IM Fell English (OFL). Built with ",
          link("three.js", "https://threejs.org"),
          ". ",
          link("Licences", "/licenses.txt"),
        ],
      }),
      el("p", { class: "by", text: "By Kaydjen" }),
    ],
  });
  document.body.append(panel);
  dock.append(button);

  const set = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.classList.toggle("on", open);
  };
  button.addEventListener("click", () => set(panel.hasAttribute("hidden")));
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hasAttribute("hidden") && !panel.contains(event.target as Node) && event.target !== button) set(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hasAttribute("hidden")) set(false);
  });
}
