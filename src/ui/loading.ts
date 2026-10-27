import { el } from "./dom";

export interface Loading {
  done(): void;
}

/** Loading: black screen with three brass dots pulsing in turn in the centre, shown if the load takes longer than 150 ms. No text. */
export function showLoading(): Loading {
  const dots = el("div", { class: "loading-dots", attrs: { "aria-hidden": "true" }, children: [el("i", {}), el("i", {}), el("i", {})] });
  document.body.append(dots);
  const timer = window.setTimeout(() => dots.classList.add("shown"), 150);
  return {
    done() {
      window.clearTimeout(timer);
      dots.classList.remove("shown");
      window.setTimeout(() => dots.remove(), 700);
    },
  };
}
