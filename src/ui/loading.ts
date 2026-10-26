import { el } from "./dom";

export interface Loading {
  done(): void;
}

/** Loading: black screen; a 1 px brass line grows along the bottom if generation takes longer than 400 ms. No spinner. */
export function showLoading(): Loading {
  const line = el("div", { class: "loading-line", attrs: { "aria-hidden": "true" } });
  document.body.append(line);
  const timer = window.setTimeout(() => line.classList.add("growing"), 400);
  return {
    done() {
      window.clearTimeout(timer);
      line.classList.add("finished");
      window.setTimeout(() => line.remove(), 600);
    },
  };
}
