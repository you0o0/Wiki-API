import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const BASE_DIR = "./data/wikipedia";
const CATEGORIES = {
  علوم: "Science",
  تكنولوجيا: "Technology",
  ثقافة: "Culture",
  تاريخ: "History",
  جغرافيا: "Geography",
  رياضة: "Sports",
  طب: "Medicine",
  "صحة نفسية": "MentalHealth",
  بيئة: "Environment",
  تغذية: "Nutrition",
  سياحة: "Tourism",
};

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

async function processCategory(arName, enFile) {
  console.log(`\n--- Processing category: ${arName} -> ${enFile}.json`);
  const members = await fetchCategoryMembers(arName);
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
  const filePath = path.join(outputDir, `${enFile}.json`);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`  ✅ saved: ${filePath}`);
}

async function fetchFeaturedArticle() {
  console.log(`\n--- Fetching Featured Article`);
  const url = `https://ar.wikipedia.org/api/rest_v1/feed/featured/2025/10/18`;
  const res = await fetch(url);
  const data = await res.json();
  const article = data.tfa; // فقط المقالة المختارة
  if (!article) return;

  const featured = {
    title: article.titles?.normalized,
    description: article.description,
    image: article.thumbnail?.source || "",
    url: article.content_urls?.desktop?.page,
    html: await fetchArticleHTML(article.titles?.normalized),
  };

  const outputDir = path.join(BASE_DIR, "featured");
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "featured.json");
  fs.writeFileSync(filePath, JSON.stringify(featured, null, 2), "utf-8");
  console.log(`  ✅ featured saved: ${filePath}`);
}

(async () => {
  console.log("🚀 Start fetching Wikipedia data (HTML mode)...");
  for (const [ar, en] of Object.entries(CATEGORIES)) {
    await processCategory(ar, en);
  }
  await fetchFeaturedArticle();
  console.log("🎉 All done with HTML articles!");
})();
