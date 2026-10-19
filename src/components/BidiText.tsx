import { Fragment, memo } from "react";
import { textDirection } from "@/lib/shared/text";

/**
 * Renders model output as *text* (never HTML) with per-paragraph direction and
 * isolation of embedded opposite-direction runs (URLs, English terms, numbers with units).
 */
const URL_RE = /(https?:\/\/[^\s<>"'«»]+|www\.[^\s<>"'«»]+|[\w.+-]+@[\w-]+\.[\w.-]+)/gu;
const L = "A-Za-z\\u00C0-\\u024F";
const WORD = `[${L}0-9](?:[${L}0-9'’\\-+/.%°µ]*[${L}0-9%°µ])?`;
/** Latin runs start with a letter and never swallow trailing sentence punctuation (so "L5." keeps its period outside the isolate). */
const LATIN_RUN = new RegExp(`([${L}](?:[${L}0-9'’\\-+/.%°µ]*[${L}0-9%°µ])?(?:[ \\t]+${WORD})*)`, "g");

function isolate(line: string, base: "rtl" | "ltr", keyBase: string) {
  const parts = line.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1)
      return (
        <bdi key={`${keyBase}u${i}`} dir="ltr">
          {part}
        </bdi>
      );
    if (base === "ltr") return <Fragment key={`${keyBase}t${i}`}>{part}</Fragment>;
    const sub = part.split(LATIN_RUN);
    return sub.map((s, j) =>
      j % 2 === 1 ? (
        <bdi key={`${keyBase}l${i}-${j}`} dir="ltr">
          {s}
        </bdi>
      ) : (
        <Fragment key={`${keyBase}t${i}-${j}`}>{s}</Fragment>
      ),
    );
  });
}

export const BidiText = memo(function BidiText({ text, fallbackDir, streaming = false }: { text: string; fallbackDir: "rtl" | "ltr"; streaming?: boolean }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const dir = textDirection(para, fallbackDir);
        const lines = para.split("\n");
        const last = pi === paragraphs.length - 1;
        return (
          <p key={pi} dir={dir} className={`mb-3 last:mb-0 whitespace-pre-wrap ${streaming && last ? "caret-blink" : ""}`} style={{ textAlign: "start" }}>
            {lines.map((ln, li) => (
              <Fragment key={li}>
                {li > 0 && "\n"}
                {(() => {
                  const ld = textDirection(ln, dir);
                  const inner = isolate(ln, ld, `${pi}-${li}-`);
                  return ld === dir ? inner : <bdi dir={ld}>{inner}</bdi>;
                })()}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
});
