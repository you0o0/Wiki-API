import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const BASE_DIR = "./data/wikipedia";
const CATEGORY_NAME_AR = "جغرافيا"; // ✅ التصنيف المطلوب فقط
const CATEGORY_FILE_EN = "Geography"; // اسم الملف

async function fetchCategoryMembers(category) {
  const url = `https://ar.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=categorymembers&cmtitle=تصنيف:${category}&cmlimit=max`;
  const res = await fetch(url);
  const data = await res.json();
  return data.query?.categorymembers || [];
}

async function fetchArticleHTML(title) {
  try {
    const encoded = encodeURIComponent(title);
    const url = `https://ar.wikipedia.org/api/rest_v1/page/html/${encoded}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    return html;
  } catch (e) {
    console.error("❌ HTML Fetch Error:", title, e.message);
    return null;
  }
}

async function fetchArticleMeta(title) {
  const encoded = encodeURIComponent(title);
  const url = `https://ar.wikipedia.org/w/api.php?action=query&prop=pageimages|info|description&format=json&inprop=url&origin=*&titles=${encoded}&pithumbsize=400`;
  const res = await fetch(url);
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  return {
    title: page.title,
    description: page.description || "",
    image: page.thumbnail?.source || "",
    lastrevid: page.lastrevid || "",
    url: page.fullurl || "",
  };
}

async function processCategory(categoryAr, fileNameEn) {
  console.log(`\n--- Processing category: ${categoryAr} -> ${fileNameEn}.json`);
  const members = await fetchCategoryMembers(categoryAr);
  const validMembers = members.filter(m => !m.title.startsWith("مستخدم:") && !m.title.startsWith("User:"));
  console.log(`  members: ${validMembers.length}`);

  const results = [];
  for (const member of validMembers) {
    const meta = await fetchArticleMeta(member.title);
    const html = await fetchArticleHTML(member.title);
    if (!html) continue;

    results.push({
      title: meta.title,
      description: meta.description,
      image: meta.image,
      url: meta.url,
      lastrevid: meta.lastrevid,
      html: html, // ✅ المقال بصيغة HTML الجاهزة
    });
  }

  const outputDir = path.join(BASE_DIR, "categories");
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${fileNameEn}.json`);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`  ✅ saved: ${filePath}`);
}

(async () => {
  console.log("🚀 Start fetching Wikipedia data (HTML mode)...");

  await processCategory(CATEGORY_NAME_AR, CATEGORY_FILE_EN);

  console.log("🎉 Done fetching single category (Geography).");
})();
