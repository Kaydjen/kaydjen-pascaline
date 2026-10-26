import numeralItalicUrl from "@fontsource/im-fell-english/files/im-fell-english-latin-400-italic.woff2?url";
import numeralUrl from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url";
import chipUrl from "@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2?url";

/** Bundled OFL faces (docs: credits panel lists them). Canvas text must use these names only. */
/** Lining figures (IM Fell has old-style ones, whose 0 reads as an "o"): EB Garamond for every numeral. */
export const FONT_NUMERAL = '"EB Garamond"';
export const FONT_LABEL = '"IM Fell English Italic"';
export const FONT_CHIP = '"EB Garamond Italic"';

const FACES: [string, string, FontFaceDescriptors][] = [
  ["EB Garamond", numeralUrl, { style: "normal", weight: "400" }],
  ["IM Fell English Italic", numeralItalicUrl, { style: "italic", weight: "400" }],
  ["EB Garamond Italic", chipUrl, { style: "italic", weight: "400" }],
];

let loading: Promise<void> | null = null;

/** Loads the bundled fonts once; canvas textures are generated only after this resolves. */
export function loadFonts(): Promise<void> {
  loading ??= (async () => {
    if (typeof document === "undefined") return;
    const loaded = await Promise.all(FACES.map(([family, url, descriptors]) => new FontFace(family, `url(${url})`, descriptors).load()));
    loaded.forEach((face) => document.fonts.add(face));
  })();
  return loading;
}
