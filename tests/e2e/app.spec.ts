import { expect, test } from "@playwright/test";

const AR_SRC = "المريض ما عندوش ضعف في الرجل الشمال، و الرنين بيوضح انزلاق غضروفي محتمل بين الفقرة L4 و L5. ياخد Pregabalin 75 mg مرتين يوميا لمدة ٤ اسابيع.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sr:prefs:v1", JSON.stringify({ uiLang: "ar", theme: "light" })));
});

test("Arabic RTL rewrite end-to-end (real SDK → mock Gemini) with no horizontal scroll", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("textbox", { name: "النص الأصلي" }).fill(AR_SRC);
  await page.screenshot({ path: `test-results/${info.project.name}-1-input.png` });
  await page.getByRole("button", { name: "إعادة صياغة" }).click();
  await expect(page.getByRole("status").getByText("اكتملت")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("يحتاج إلى مراجعتك")).toBeVisible();
  await expect(page.locator("#panel-result")).toContainText("Pregabalin");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/${info.project.name}-2-result-ar.png` });
});

test("English, dark theme, more options", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("sr:prefs:v1", JSON.stringify({ uiLang: "en", theme: "dark" })));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("textbox", { name: "Original text" }).fill("the results shows that 63% of patient improved (p=0.04) [12], however this do not proves causation.");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("radio", { name: "Medical" }).click();
    await page.screenshot({ path: `test-results/${info.project.name}-3-options-dark.png` });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: /Medical/ })).toBeVisible();
  } else {
    await page.getByRole("button", { name: /More options/ }).click();
    await page.screenshot({ path: `test-results/${info.project.name}-3-options-dark.png` });
    await page.getByRole("button", { name: /More options/ }).click();
  }
  await page.getByRole("button", { name: "Rephrase", exact: true }).click();
  await expect(page.getByRole("status").getByText("Done", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#panel-result")).toContainText("does not prove causation");
  await page.screenshot({ path: `test-results/${info.project.name}-4-result-en-dark.png` });
});

test("stalled stream ends in a labelled partial, never an endless spinner; input preserved", async ({ page }, info) => {
  await page.goto("/");
  const src = "STALL " + AR_SRC;
  await page.getByRole("textbox", { name: "النص الأصلي" }).fill(src);
  await page.getByRole("button", { name: "إعادة صياغة" }).click();
  await expect(page.getByText("نتيجة غير مكتملة")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "إعادة البدء" })).toBeVisible();
  const tab = page.getByRole("tab", { name: "النص الأصلي" });
  if (await tab.isVisible()) await tab.click();
  await expect(page.getByRole("textbox", { name: "النص الأصلي" })).toHaveValue(src);
  await page.screenshot({ path: `test-results/${info.project.name}-5-partial.png` });
});

test("quota exhausted shows an actionable localized error without retry loops", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "النص الأصلي" }).fill("QUOTA نص");
  await page.getByRole("button", { name: "إعادة صياغة" }).click();
  await expect(page.getByText(/نفدت حصة Gemini API/)).toBeVisible({ timeout: 10_000 });
});

test("security headers and no secret in served HTML", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(await res.text()).not.toContain("e2e-dummy");
  const api = await request.post("/api/rephrase", { data: {}, headers: { origin: "https://evil.example" } });
  expect(api.status()).toBe(403);
});

test("abbreviations: real keyboard typing expands, suggestions and manager work", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("sr:prefs:v1", JSON.stringify({ uiLang: "en", theme: "light" })));
  await page.goto("/");
  const ed = page.getByRole("textbox", { name: "Original text" });
  await ed.click();
  await page.keyboard.type("pt with ldnot ");
  await expect(ed).toHaveValue("PATIENT with LUMBAR DISCS NOT IMPROVED BY MEDICAL TREATMENT ");
  await page.keyboard.press("Backspace");
  await expect(ed).toHaveValue("PATIENT with ldnot");
  await page.keyboard.type(" advice mri");
  await expect(page.getByRole("button", { name: /MRICX/ })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-6-abbr-typing.png` });
  await page.getByRole("button", { name: /MRICX/ }).click();
  await expect(ed).toHaveValue("PATIENT with ldnot advice MRI CERVICAL SPINE ");
  await page.getByRole("button", { name: "Abbreviations" }).first().click();
  await expect(page.getByRole("dialog", { name: "Abbreviations" })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-7-abbr-manager.png` });
});
