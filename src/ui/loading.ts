import { loadFonts } from "../materials/fonts";
import { el } from "./dom";

export interface Loading {
  done(): void;
}

/**
 * Loading: black screen with three brass dots pulsing in turn in the centre and, under them, the name and the author. Shown if the
 * load takes longer than 150 ms (and once the bundled font is there, so that the name does not jump from one face to another).
 */
export function showLoading(): Loading {
  const dots = el("div", { class: "loading-dots", attrs: { "aria-hidden": "true" }, children: [el("i", {}), el("i", {}), el("i", {})] });
  const title = el("div", {
    class: "loading-title",
    attrs: { "aria-hidden": "true" },
    children: [el("p", { class: "name", text: "Pascaline" }), el("p", { class: "by", text: "By Kaydjen" })],
  });
  document.body.append(dots, title);
  let gone = false;
  const show = (): void => {
    if (gone) return;
    dots.classList.add("shown");
    title.classList.add("shown");
  };
  const timer = window.setTimeout(() => void loadFonts().then(show, show), 150);
  return {
    done() {
      gone = true;
      window.clearTimeout(timer);
      dots.classList.remove("shown");
      title.classList.remove("shown");
      window.setTimeout(() => {
        dots.remove();
        title.remove();
      }, 700);
    },
  };
}
