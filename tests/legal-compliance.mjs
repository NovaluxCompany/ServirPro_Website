// Script de verificación (no usa un test runner, usa la librería `playwright` directamente).
// Requiere que el servidor de desarrollo esté corriendo en http://localhost:4321
// Uso: node tests/legal-compliance.mjs

import { chromium } from "playwright";

const BASE_URL = "http://localhost:4321";

const LANDING_PAGES = [
  "/afiliacion-eps",
  "/afiliacion-arl",
  "/afiliaciones-pension",
  "/afiliaciones-seguridad-social",
  "/arl-empresas",
  "/compra-cartera-vehiculos",
  "/polizas-colectivas",
  "/polizas-salud",
  "/seguros-hogar",
  "/seguros-vehiculo",
  "/seguros-vida",
];

const COMPLIANCE_TEXT = "Servicio sujeto a condiciones y tarifas";
const NEW_ARL_PHRASE = "Te asesoramos y gestionamos";
const OLD_ARL_PHRASE = "Afiliamos independientes";
const LEGAL_CLAUSE =
  "ServirPRO no es una entidad gubernamental, EPS ni ARL. Es una empresa privada e independiente que presta servicios de asesoría y gestión administrativa.";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await chromium.launch();

// 1. Redirect /empresas -> /arl-empresas
{
  const ctx = await browser.newContext();
  const res1 = await ctx.request.get(`${BASE_URL}/empresas`, { maxRedirects: 0 });
  record(
    "/empresas responde 3xx",
    res1.status() >= 300 && res1.status() < 400,
    `status=${res1.status()}`,
  );
  record(
    "/empresas redirige a /arl-empresas",
    (res1.headers()["location"] || "").includes("/arl-empresas"),
    `location=${res1.headers()["location"]}`,
  );

  const res2 = await ctx.request.get(`${BASE_URL}/empresas/`, { maxRedirects: 0 });
  record(
    "/empresas/ (con slash) redirige a /arl-empresas",
    (res2.headers()["location"] || "").includes("/arl-empresas"),
    `status=${res2.status()} location=${res2.headers()["location"]}`,
  );
  await ctx.close();
}

// 2. Compliance notice presente y antes del Footer en las 11 landings
for (const path of LANDING_PAGES) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  record(`${path} responde 200`, res.status() === 200, `status=${res.status()}`);

  const bodyText = await page.locator("body").innerText();
  record(`${path} contiene el aviso corto`, bodyText.includes(COMPLIANCE_TEXT));

  const order = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("body *"));
    const noticeIdx = all.findIndex((el) =>
      norm(el.textContent).includes("Servicio sujeto a condiciones y tarifas") &&
      el.children.length === 0,
    );
    const footerIdx = all.findIndex((el) => el.tagName === "FOOTER");
    return { noticeIdx, footerIdx };
  });
  record(
    `${path} aviso corto aparece antes del <footer>`,
    order.noticeIdx !== -1 && order.footerIdx !== -1 && order.noticeIdx < order.footerIdx,
    `noticeIdx=${order.noticeIdx} footerIdx=${order.footerIdx}`,
  );

  record(`${path} sin errores de consola`, consoleErrors.length === 0, consoleErrors.join(" | "));

  await page.close();
}

// 3. Textos específicos EPS/ARL + botones en desktop y mobile
const VIEWPORTS = [
  { width: 1366, height: 900, label: "desktop" },
  { width: 390, height: 844, label: "mobile" },
];

for (const path of ["/afiliacion-eps", "/afiliacion-arl"]) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });

    const bodyText = await page.locator("body").innerText();

    if (path === "/afiliacion-arl") {
      record(`${path} @${vp.label}: frase nueva presente`, bodyText.includes(NEW_ARL_PHRASE));
      record(`${path} @${vp.label}: frase vieja ausente`, !bodyText.includes(OLD_ARL_PHRASE));
    }

    // WhatsApp buttons visibles
    const waLinks = await page.locator("a[href*='wa.me']").all();
    let anyVisible = false;
    for (const l of waLinks) {
      const box = await l.boundingBox();
      if (box && box.width > 0 && box.height > 0) anyVisible = true;
    }
    record(`${path} @${vp.label}: al menos un botón de WhatsApp visible`, anyVisible, `total=${waLinks.length}`);

    // Sin aviso legal pegado al hero (primeros 700px del documento)
    const heroHasLegalNotice = await page.evaluate(() => {
      const hero = document.querySelector("section");
      if (!hero) return false;
      const text = hero.textContent || "";
      return /empresa privada|entidad gubernamental|sujeto a condiciones/i.test(text);
    });
    record(`${path} @${vp.label}: sin aviso legal junto al hero`, !heroHasLegalNotice);

    record(`${path} @${vp.label}: sin errores de consola`, consoleErrors.length === 0, consoleErrors.join(" | "));

    await page.close();
  }
}

// 4. Aviso legal contiene la cláusula nueva
{
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/aviso-legal`, { waitUntil: "networkidle" });
  const bodyText = await page.locator("body").innerText();
  record("Aviso Legal contiene la cláusula EPS/ARL/gubernamental", bodyText.includes(LEGAL_CLAUSE));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
if (failed.length) {
  console.log(`\n${failed.length} fallo(s):`);
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ? `(${f.detail})` : ""}`));
  process.exit(1);
} else {
  process.exit(0);
}
