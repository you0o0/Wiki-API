import fs from "fs-extra";
import fetch from "node-fetch";

const BASE_DIR = "data/wikipedia";
const CATEGORIES_DIR = `${BASE_DIR}/categories`;
const FEATURED_DIR = `${BASE_DIR}/featured`;
const ONTHISDAY_DIR = `${BASE_DIR}/onthisday`;

await fs.ensureDir(CATEGORIES_DIR);
await fs.ensureDir(FEATURED_DIR);
await fs.ensureDir(ONTHISDAY_DIR);

const CATEGORIES = {
  "علوم": "Science",
  "تكنولوجيا": "Technology",
  "ثقافة": "Culture",
  "تاريخ": "History",
  "جغرافيا": "Geography",
  "رياضة": "Sports",
  "طب": "Medicine",
  "صحة_نفسية": "MentalHealth",
  "بيئة": "Environment",
  "تغذية": "Nutrition",
  "سياحة": "Tourism",
};

// 🧹 استبعاد صفحات المستخدمين والملعب
function isValidArticle(title) {
  const invalidPrefixes = [
    "مستخدم:",
    "User:",
    "Wikipedia:",
    "ملعب:",
    "Draft:",
    "Sandbox:",
  ];
  return !invalidPrefixes.some((p) => title.startsWith(p));
}

// 🔍 جلب قائمة المقالات في تصنيف معين
async function fetchCategoryMembers(category) {
  let allPages = [];
  let cont = "";
  do {
    const url = `https://ar.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=categorymembers&cmtitle=Category:${encodeURIComponent(
      category
    )}&cmlimit=100&cmcontinue=${cont}`;
    const res = await fetch(url);
    const data = await res.json();

    const pages = data.query?.categorymembers?.filter((p) =>
      isValidArticle(p.title)
    );
    allPages.push(...pages);

    cont = data.continue?.cmcontinue || "";
  } while (cont);

  return allPages;
}

// 🧾 جلب HTML المنسق للمقال
async function fetchArticleHTML(title) {
  const url = `https://ar.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    title
  )}&format=json&origin=*&prop=text|images|revid|displaytitle`;
  const res = await fetch(url);
  const data = await res.json();

  const html = data.parse?.text?.["*"] || "";
  const lastModified = data.parse?.revid || null;

  // جلب أول صورة لو متاحة
  const imageTitle = data.parse?.images?.[0];
  const thumbnail = imageTitle
    ? `https://ar.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(
        imageTitle
      )}`
    : null;

  return {
    title: data.parse?.title || title,
    html,
    lastModified,
    thumbnail,
  };
}

// 💾 حفظ بيانات في JSON فقط لو تغيرت فعلاً
async function saveIfChanged(filePath, data) {
  let changed = true;
  if (await fs.pathExists(filePath)) {
    const oldData = await fs.readJSON(filePath);
    changed = JSON.stringify(oldData) !== JSON.stringify(data);
  }
  if (changed) {
    await fs.outputJSON(filePath, data, { spaces: 2 });
    console.log(`  saved: ${filePath} (changed: true)`);
  } else {
    console.log(`  no changes: ${filePath}`);
  }
}

// 🧠 جلب المقالات لتصنيف واحد
async function processCategory(arabicName, englishFile) {
  console.log(`\n--- Processing category: ${arabicName} -> ${englishFile}.json`);
  const members = await fetchCategoryMembers(arabicName);
  console.log(`  members: ${members.length}`);

  if (members.length === 0) {
    console.log("  ⚠️ No members found, skipping.");
    return;
  }

  const articles = [];

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    console.log(`   ↳ [${i + 1}/${members.length}] ${m.title}`);
    try {
      const article = await fetchArticleHTML(m.title);
      articles.push(article);
      await new Promise((r) => setTimeout(r, 100)); // لتفادي الضغط على API
    } catch (e) {
      console.warn(`   ⚠️ Error fetching "${m.title}":`, e.message);
    }
  }

  await saveIfChanged(`${CATEGORIES_DIR}/${englishFile}.json`, articles);
}

// 🌟 جلب مقالة اليوم المختارة فقط
async function fetchFeaturedArticle() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  const url = `https://ar.wikipedia.org/api/rest_v1/feed/featured/${year}/${month}/${day}`;
  const res = await fetch(url);
  const data = await res.json();

  const article = data?.tfa || null;
  if (article) {
    const simplified = {
      title: article.title,
      description: article.extract,
      html: article.content_urls?.desktop?.page
        ? `<a href="${article.content_urls.desktop.page}">${article.title}</a>`
        : "",
      thumbnail: article.thumbnail?.source || null,
    };
    await saveIfChanged(`${FEATURED_DIR}/article.json`, simplified);
    console.log("✅ featured article saved");
  } else {
    console.log("⚠️ No featured article found");
  }
}

// 📅 جلب أحداث اليوم
async function fetchOnThisDay() {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const dateStr = `${now.getUTCFullYear()}-${month}-${day}`;
  const url = `https://ar.wikipedia.org/api/rest_v1/feed/onthisday/all/${month}/${day}`;
  const res = await fetch(url);
  const data = await res.json();

  await saveIfChanged(`${ONTHISDAY_DIR}/${dateStr}.json`, data);
  console.log(`✅ onthisday saved: ${dateStr}`);
}

// 🚀 تنفيذ كامل
console.log("Start fetching Wikipedia data...\n");

for (const [ar, en] of Object.entries(CATEGORIES)) {
  await processCategory(ar, en);
}

await fetchFeaturedArticle();
await fetchOnThisDay();

console.log("\n✅ All done.");
